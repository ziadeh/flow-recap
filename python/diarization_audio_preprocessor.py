#!/usr/bin/env python3
"""
diarization_audio_preprocessor.py - Audio Preprocessing Pipeline Optimized for Speaker Diarization

This module implements an audio preprocessing pipeline specifically designed to MAXIMIZE
speaker diarization accuracy by preserving speaker embeddings and voice characteristics.

KEY DESIGN PRINCIPLES:
1. MINIMIZE DESTRUCTIVE PROCESSING: Aggressive noise suppression, echo cancellation, and
   loudness normalization DESTROY speaker embeddings and reduce diarization accuracy.
2. DUAL AUDIO PATHS: Separate audio streams for diarization (minimal processing) and
   transcription (may include noise reduction for better ASR).
3. AUDIO QUALITY VALIDATION: Detect issues that degrade speaker separation (clipping,
   severe noise, low SNR) and warn users proactively.
4. OPTIMAL FORMAT: 16kHz mono PCM format for pyannote.audio compatibility.

Audio Processing Pipelines:
    DIARIZATION PATH (Minimal Processing):
        Raw Audio -> Light DC Offset Removal -> Gentle Peak Limiting -> 16kHz Mono PCM

    TRANSCRIPTION PATH (Enhanced Processing):
        Raw Audio -> Noise Reduction -> Normalization -> 16kHz Mono PCM

Usage:
    from diarization_audio_preprocessor import DiarizationAudioPreprocessor, AudioQualityReport

    # Initialize preprocessor
    preprocessor = DiarizationAudioPreprocessor(sample_rate=16000)

    # Process for diarization (MINIMAL processing to preserve speaker embeddings)
    diarization_audio, quality_report = preprocessor.prepare_for_diarization(audio_path)

    # Check quality warnings
    if quality_report.has_warnings:
        for warning in quality_report.warnings:
            print(f"Warning: {warning}")

    # Optionally, process for transcription (with noise reduction)
    transcription_audio = preprocessor.prepare_for_transcription(audio_path)
"""

import argparse
import json
import os
import sys
import tempfile
import warnings
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np

# Suppress warnings for cleaner output
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

# Suppress torchaudio deprecation warnings specifically
# These warnings come from pyannote.audio using deprecated torchaudio.list_audio_backends()
# See: https://github.com/pytorch/audio/issues/3902
warnings.filterwarnings(
    "ignore",
    message=".*torchaudio._backend.list_audio_backends has been deprecated.*",
    category=UserWarning
)
warnings.filterwarnings(
    "ignore",
    message=".*list_audio_backends.*",
    category=UserWarning
)

# Import audio processing libraries
try:
    import soundfile as sf
    SOUNDFILE_AVAILABLE = True
except ImportError:
    SOUNDFILE_AVAILABLE = False

try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False

try:
    import torchaudio
    import torch
    TORCHAUDIO_AVAILABLE = True
except ImportError:
    TORCHAUDIO_AVAILABLE = False

# Try to import ffmpeg for format conversion
try:
    import ffmpeg
    FFMPEG_AVAILABLE = True
except ImportError:
    FFMPEG_AVAILABLE = False


# ============================================================================
# Constants
# ============================================================================

# Target audio format for diarization
DIARIZATION_SAMPLE_RATE = 16000  # pyannote.audio expects 16kHz
DIARIZATION_CHANNELS = 1  # Mono
DIARIZATION_BIT_DEPTH = 16  # 16-bit PCM

# Quality thresholds
CLIPPING_THRESHOLD = 0.99  # Peak amplitude that indicates clipping
CLIPPING_PERCENTAGE_WARNING = 0.1  # Warn if >0.1% of samples are clipping
LOW_SNR_THRESHOLD_DB = 10.0  # Warn if SNR is below 10dB
HIGH_NOISE_FLOOR_DB = -35.0  # Warn if noise floor is above -35dB
MIN_DYNAMIC_RANGE_DB = 20.0  # Warn if dynamic range is below 20dB
SILENCE_THRESHOLD_DB = -50.0  # Silence detection threshold
MIN_AUDIO_DURATION_S = 1.0  # Minimum audio duration for quality analysis

# Peak limiting for diarization (very gentle to preserve speaker characteristics)
PEAK_LIMIT_DB = -1.0  # Limit peaks to -1dB to prevent clipping
PEAK_LIMIT_RATIO = 10 ** (PEAK_LIMIT_DB / 20)  # ~0.89


# ============================================================================
# Enums and Data Classes
# ============================================================================

class AudioQualityLevel(Enum):
    """Quality assessment levels."""
    EXCELLENT = "excellent"  # Optimal for diarization
    GOOD = "good"  # Acceptable for diarization
    FAIR = "fair"  # May have reduced diarization accuracy
    POOR = "poor"  # Significant issues affecting diarization
    CRITICAL = "critical"  # Audio is likely unusable for diarization


class AudioQualityIssue(Enum):
    """Types of audio quality issues."""
    CLIPPING = "clipping"  # Audio is clipping/distorted
    LOW_SNR = "low_snr"  # Signal-to-noise ratio is too low
    HIGH_NOISE = "high_noise"  # High background noise level
    LOW_VOLUME = "low_volume"  # Audio level is too low
    DC_OFFSET = "dc_offset"  # Significant DC offset present
    MONO_TO_STEREO = "mono_to_stereo"  # Stereo audio with mono content
    SHORT_DURATION = "short_duration"  # Audio is very short
    SAMPLE_RATE_MISMATCH = "sample_rate_mismatch"  # Non-optimal sample rate


@dataclass
class AudioQualityWarning:
    """Represents a single audio quality warning."""
    issue: AudioQualityIssue
    severity: str  # "info", "warning", "error"
    message: str
    value: Optional[float] = None  # Measured value
    threshold: Optional[float] = None  # Threshold that was exceeded
    recommendation: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "issue": self.issue.value,
            "severity": self.severity,
            "message": self.message,
            "value": self.value,
            "threshold": self.threshold,
            "recommendation": self.recommendation
        }


@dataclass
class AudioQualityReport:
    """
    Comprehensive audio quality report for diarization optimization.

    This report helps users understand if their audio is suitable for
    accurate speaker diarization.
    """
    # Overall assessment
    overall_quality: AudioQualityLevel = AudioQualityLevel.GOOD
    diarization_suitability: float = 1.0  # 0.0-1.0 score

    # Detailed metrics
    peak_amplitude: float = 0.0  # Maximum amplitude (0.0-1.0)
    rms_level_db: float = -60.0  # RMS level in dB
    noise_floor_db: float = -60.0  # Estimated noise floor in dB
    estimated_snr_db: float = 30.0  # Estimated SNR in dB
    dynamic_range_db: float = 40.0  # Dynamic range in dB
    clipping_percentage: float = 0.0  # Percentage of clipping samples
    dc_offset: float = 0.0  # DC offset value
    silence_percentage: float = 0.0  # Percentage of silent frames

    # Audio properties
    sample_rate: int = 16000
    channels: int = 1
    duration_seconds: float = 0.0
    bit_depth: int = 16

    # Warnings and recommendations
    warnings: List[AudioQualityWarning] = field(default_factory=list)

    @property
    def has_warnings(self) -> bool:
        return len(self.warnings) > 0

    @property
    def has_critical_issues(self) -> bool:
        return any(w.severity == "error" for w in self.warnings)

    @property
    def warning_count(self) -> int:
        return len([w for w in self.warnings if w.severity == "warning"])

    @property
    def error_count(self) -> int:
        return len([w for w in self.warnings if w.severity == "error"])

    def to_dict(self) -> Dict[str, Any]:
        return {
            "overall_quality": self.overall_quality.value,
            "diarization_suitability": round(self.diarization_suitability, 3),
            "metrics": {
                "peak_amplitude": round(self.peak_amplitude, 4),
                "rms_level_db": round(self.rms_level_db, 2),
                "noise_floor_db": round(self.noise_floor_db, 2),
                "estimated_snr_db": round(self.estimated_snr_db, 2),
                "dynamic_range_db": round(self.dynamic_range_db, 2),
                "clipping_percentage": round(self.clipping_percentage, 4),
                "dc_offset": round(self.dc_offset, 6),
                "silence_percentage": round(self.silence_percentage, 2)
            },
            "audio_properties": {
                "sample_rate": self.sample_rate,
                "channels": self.channels,
                "duration_seconds": round(self.duration_seconds, 3),
                "bit_depth": self.bit_depth
            },
            "warnings": [w.to_dict() for w in self.warnings],
            "summary": {
                "has_warnings": self.has_warnings,
                "has_critical_issues": self.has_critical_issues,
                "warning_count": self.warning_count,
                "error_count": self.error_count
            }
        }


@dataclass
class DiarizationPreprocessingConfig:
    """
    Configuration for diarization-optimized audio preprocessing.

    IMPORTANT: Default settings are optimized for MAXIMUM diarization accuracy.
    Aggressive processing options are DISABLED by default.
    """
    # Target format
    target_sample_rate: int = 16000
    target_channels: int = 1
    target_bit_depth: int = 16

    # Minimal processing (DEFAULT: enabled for diarization)
    remove_dc_offset: bool = True  # Remove DC offset (safe, doesn't affect speaker characteristics)
    apply_peak_limiting: bool = True  # Gentle peak limiting to prevent clipping
    peak_limit_db: float = -1.0  # Very gentle limiting

    # DESTRUCTIVE PROCESSING (DEFAULT: DISABLED for diarization)
    # These options DESTROY speaker embeddings and REDUCE diarization accuracy!
    apply_noise_suppression: bool = False  # DO NOT enable for diarization
    apply_echo_cancellation: bool = False  # DO NOT enable for diarization
    apply_loudness_normalization: bool = False  # DO NOT enable for diarization
    apply_compression: bool = False  # DO NOT enable for diarization
    apply_high_pass_filter: bool = False  # May remove low-frequency speaker characteristics

    # Quality validation
    validate_quality: bool = True
    warn_on_clipping: bool = True
    warn_on_low_snr: bool = True
    warn_on_high_noise: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "target_format": {
                "sample_rate": self.target_sample_rate,
                "channels": self.target_channels,
                "bit_depth": self.target_bit_depth
            },
            "minimal_processing": {
                "remove_dc_offset": self.remove_dc_offset,
                "apply_peak_limiting": self.apply_peak_limiting,
                "peak_limit_db": self.peak_limit_db
            },
            "destructive_processing_disabled": {
                "noise_suppression": not self.apply_noise_suppression,
                "echo_cancellation": not self.apply_echo_cancellation,
                "loudness_normalization": not self.apply_loudness_normalization,
                "compression": not self.apply_compression
            },
            "quality_validation": {
                "enabled": self.validate_quality,
                "warn_clipping": self.warn_on_clipping,
                "warn_low_snr": self.warn_on_low_snr,
                "warn_high_noise": self.warn_on_high_noise
            }
        }


# ============================================================================
# Audio Quality Analyzer
# ============================================================================

class AudioQualityAnalyzer:
    """
    Analyzes audio quality for speaker diarization suitability.

    Detects issues that would degrade speaker separation:
    - Clipping/distortion
    - Severe background noise
    - Low SNR
    - DC offset
    """

    def __init__(self, sample_rate: int = 16000):
        self.sample_rate = sample_rate

    def analyze(self, audio: np.ndarray, sample_rate: int) -> AudioQualityReport:
        """
        Perform comprehensive audio quality analysis.

        Args:
            audio: Float32 numpy array of audio samples [-1, 1]
            sample_rate: Sample rate of the audio

        Returns:
            AudioQualityReport with detailed analysis
        """
        report = AudioQualityReport()
        report.sample_rate = sample_rate
        report.channels = 1 if len(audio.shape) == 1 else audio.shape[1]
        report.duration_seconds = len(audio) / sample_rate

        # Ensure mono for analysis
        if len(audio.shape) > 1 and audio.shape[1] > 1:
            audio = np.mean(audio, axis=1)

        # Basic metrics
        report.peak_amplitude = float(np.max(np.abs(audio)))
        report.dc_offset = float(np.mean(audio))

        # RMS level
        rms = np.sqrt(np.mean(audio ** 2))
        report.rms_level_db = 20 * np.log10(rms + 1e-10)

        # Clipping detection
        clipping_samples = np.sum(np.abs(audio) >= CLIPPING_THRESHOLD)
        report.clipping_percentage = (clipping_samples / len(audio)) * 100

        # Noise floor estimation (using lowest 10% of frames)
        frame_size = int(0.02 * sample_rate)  # 20ms frames
        if len(audio) >= frame_size:
            num_frames = len(audio) // frame_size
            frame_energies = []
            for i in range(num_frames):
                frame = audio[i * frame_size:(i + 1) * frame_size]
                frame_rms = np.sqrt(np.mean(frame ** 2))
                if frame_rms > 0:
                    frame_energies.append(20 * np.log10(frame_rms + 1e-10))

            if frame_energies:
                frame_energies.sort()
                # Use lowest 10% of frames as noise floor estimate
                noise_frames = frame_energies[:max(1, len(frame_energies) // 10)]
                report.noise_floor_db = float(np.mean(noise_frames))

                # Dynamic range
                report.dynamic_range_db = max(frame_energies) - min(frame_energies)

                # Silence percentage
                silent_frames = sum(1 for e in frame_energies if e < SILENCE_THRESHOLD_DB)
                report.silence_percentage = (silent_frames / len(frame_energies)) * 100

        # SNR estimation
        report.estimated_snr_db = report.rms_level_db - report.noise_floor_db

        # Generate warnings
        self._generate_warnings(report)

        # Calculate overall quality
        self._calculate_overall_quality(report)

        return report

    def _generate_warnings(self, report: AudioQualityReport) -> None:
        """Generate warnings based on quality metrics."""
        warnings = []

        # Clipping warning
        if report.clipping_percentage > CLIPPING_PERCENTAGE_WARNING:
            severity = "error" if report.clipping_percentage > 1.0 else "warning"
            warnings.append(AudioQualityWarning(
                issue=AudioQualityIssue.CLIPPING,
                severity=severity,
                message=f"Audio is clipping ({report.clipping_percentage:.2f}% of samples)",
                value=report.clipping_percentage,
                threshold=CLIPPING_PERCENTAGE_WARNING,
                recommendation="Reduce input gain or move microphone further from sound source. "
                              "Clipping destroys speaker characteristics and reduces diarization accuracy."
            ))

        # Low SNR warning
        if report.estimated_snr_db < LOW_SNR_THRESHOLD_DB:
            severity = "error" if report.estimated_snr_db < 5.0 else "warning"
            warnings.append(AudioQualityWarning(
                issue=AudioQualityIssue.LOW_SNR,
                severity=severity,
                message=f"Signal-to-noise ratio is low ({report.estimated_snr_db:.1f}dB)",
                value=report.estimated_snr_db,
                threshold=LOW_SNR_THRESHOLD_DB,
                recommendation="Reduce background noise, move microphone closer to speakers, "
                              "or use a directional microphone. Low SNR makes speaker separation difficult."
            ))

        # High noise floor warning
        if report.noise_floor_db > HIGH_NOISE_FLOOR_DB:
            warnings.append(AudioQualityWarning(
                issue=AudioQualityIssue.HIGH_NOISE,
                severity="warning",
                message=f"High background noise level ({report.noise_floor_db:.1f}dB)",
                value=report.noise_floor_db,
                threshold=HIGH_NOISE_FLOOR_DB,
                recommendation="Reduce environmental noise (HVAC, fans, etc.) or use noise isolation. "
                              "High noise interferes with speaker embedding extraction."
            ))

        # Low volume warning
        if report.rms_level_db < -40.0:
            warnings.append(AudioQualityWarning(
                issue=AudioQualityIssue.LOW_VOLUME,
                severity="warning" if report.rms_level_db > -50.0 else "error",
                message=f"Audio level is very low ({report.rms_level_db:.1f}dB RMS)",
                value=report.rms_level_db,
                threshold=-40.0,
                recommendation="Increase microphone gain or move microphone closer to speakers. "
                              "Low volume reduces speaker embedding quality."
            ))

        # DC offset warning
        if abs(report.dc_offset) > 0.01:
            warnings.append(AudioQualityWarning(
                issue=AudioQualityIssue.DC_OFFSET,
                severity="info",
                message=f"DC offset detected ({report.dc_offset:.4f})",
                value=report.dc_offset,
                threshold=0.01,
                recommendation="DC offset will be automatically removed during preprocessing."
            ))

        # Low dynamic range warning
        if report.dynamic_range_db < MIN_DYNAMIC_RANGE_DB:
            warnings.append(AudioQualityWarning(
                issue=AudioQualityIssue.HIGH_NOISE,
                severity="warning",
                message=f"Low dynamic range ({report.dynamic_range_db:.1f}dB)",
                value=report.dynamic_range_db,
                threshold=MIN_DYNAMIC_RANGE_DB,
                recommendation="Low dynamic range may indicate compression or AGC is applied. "
                              "This can reduce speaker differentiation."
            ))

        # Short duration warning
        if report.duration_seconds < MIN_AUDIO_DURATION_S:
            warnings.append(AudioQualityWarning(
                issue=AudioQualityIssue.SHORT_DURATION,
                severity="info",
                message=f"Audio duration is very short ({report.duration_seconds:.2f}s)",
                value=report.duration_seconds,
                threshold=MIN_AUDIO_DURATION_S,
                recommendation="Diarization works best with longer audio segments (>5 seconds)."
            ))

        report.warnings = warnings

    def _calculate_overall_quality(self, report: AudioQualityReport) -> None:
        """Calculate overall quality score and level."""
        # Start with perfect score
        score = 1.0

        # Deduct for issues
        if report.clipping_percentage > 1.0:
            score -= 0.3
        elif report.clipping_percentage > CLIPPING_PERCENTAGE_WARNING:
            score -= 0.15

        if report.estimated_snr_db < 5.0:
            score -= 0.3
        elif report.estimated_snr_db < LOW_SNR_THRESHOLD_DB:
            score -= 0.15

        if report.noise_floor_db > -25.0:
            score -= 0.2
        elif report.noise_floor_db > HIGH_NOISE_FLOOR_DB:
            score -= 0.1

        if report.rms_level_db < -50.0:
            score -= 0.2
        elif report.rms_level_db < -40.0:
            score -= 0.1

        if report.dynamic_range_db < 10.0:
            score -= 0.15
        elif report.dynamic_range_db < MIN_DYNAMIC_RANGE_DB:
            score -= 0.05

        # Clamp score
        score = max(0.0, min(1.0, score))
        report.diarization_suitability = score

        # Determine quality level
        if score >= 0.9:
            report.overall_quality = AudioQualityLevel.EXCELLENT
        elif score >= 0.7:
            report.overall_quality = AudioQualityLevel.GOOD
        elif score >= 0.5:
            report.overall_quality = AudioQualityLevel.FAIR
        elif score >= 0.3:
            report.overall_quality = AudioQualityLevel.POOR
        else:
            report.overall_quality = AudioQualityLevel.CRITICAL


# ============================================================================
# Diarization Audio Preprocessor
# ============================================================================

class DiarizationAudioPreprocessor:
    """
    Audio preprocessing pipeline optimized for speaker diarization accuracy.

    KEY PRINCIPLE: MINIMAL PROCESSING to preserve speaker embeddings.

    This preprocessor deliberately AVOIDS aggressive processing that would
    destroy speaker characteristics:
    - NO aggressive noise suppression
    - NO echo cancellation
    - NO loudness normalization
    - NO dynamic compression

    Only applies:
    - Format conversion (to 16kHz mono PCM)
    - DC offset removal (safe, doesn't affect speaker characteristics)
    - Gentle peak limiting (to prevent clipping)
    """

    def __init__(self, config: Optional[DiarizationPreprocessingConfig] = None):
        """
        Initialize the diarization audio preprocessor.

        Args:
            config: Optional configuration. If not provided, uses defaults
                   optimized for maximum diarization accuracy.
        """
        self.config = config or DiarizationPreprocessingConfig()
        self.quality_analyzer = AudioQualityAnalyzer(self.config.target_sample_rate)

    def prepare_for_diarization(
        self,
        audio_path: str,
        output_path: Optional[str] = None
    ) -> Tuple[str, AudioQualityReport]:
        """
        Prepare audio file for optimal speaker diarization.

        This method applies MINIMAL processing to preserve speaker embeddings:
        - Converts to 16kHz mono PCM format
        - Removes DC offset
        - Applies gentle peak limiting

        IMPORTANT: Does NOT apply noise suppression, echo cancellation,
        or loudness normalization, as these destroy speaker characteristics.

        Args:
            audio_path: Path to input audio file
            output_path: Optional path for processed output. If not provided,
                        creates a temporary file.

        Returns:
            Tuple of (processed_audio_path, quality_report)
        """
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        # Load audio
        audio, sample_rate = self._load_audio(str(audio_path))

        # Ensure mono
        if len(audio.shape) > 1 and audio.shape[1] > 1:
            audio = np.mean(audio, axis=1)

        # Analyze quality BEFORE processing
        quality_report = self.quality_analyzer.analyze(audio, sample_rate)

        # Apply minimal processing
        processed_audio = audio.copy()

        # Remove DC offset (safe for speaker embeddings)
        if self.config.remove_dc_offset:
            dc_offset = np.mean(processed_audio)
            processed_audio = processed_audio - dc_offset

        # Resample if needed
        if sample_rate != self.config.target_sample_rate:
            processed_audio = self._resample(
                processed_audio, sample_rate, self.config.target_sample_rate
            )
            quality_report.sample_rate = self.config.target_sample_rate

        # Apply gentle peak limiting (to prevent clipping without affecting dynamics)
        if self.config.apply_peak_limiting:
            peak = np.max(np.abs(processed_audio))
            if peak > PEAK_LIMIT_RATIO:
                # Soft limiting: only reduce peaks above threshold
                processed_audio = self._soft_peak_limit(
                    processed_audio, PEAK_LIMIT_RATIO
                )

        # Ensure output path
        if output_path is None:
            output_path = tempfile.mktemp(suffix="_diarization.wav")

        # Save processed audio
        self._save_audio(processed_audio, self.config.target_sample_rate, output_path)

        return output_path, quality_report

    def prepare_for_transcription(
        self,
        audio_path: str,
        output_path: Optional[str] = None,
        apply_noise_reduction: bool = True
    ) -> str:
        """
        Prepare audio file for transcription (may include noise reduction).

        This is a SEPARATE path from diarization preprocessing.
        Transcription can benefit from noise reduction, but diarization cannot.

        Args:
            audio_path: Path to input audio file
            output_path: Optional path for processed output
            apply_noise_reduction: Whether to apply noise reduction

        Returns:
            Path to processed audio file
        """
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        # Load audio
        audio, sample_rate = self._load_audio(str(audio_path))

        # Ensure mono
        if len(audio.shape) > 1 and audio.shape[1] > 1:
            audio = np.mean(audio, axis=1)

        # Remove DC offset
        audio = audio - np.mean(audio)

        # Resample if needed
        if sample_rate != self.config.target_sample_rate:
            audio = self._resample(audio, sample_rate, self.config.target_sample_rate)

        # Apply noise reduction for transcription (if requested)
        if apply_noise_reduction:
            audio = self._simple_noise_gate(audio, self.config.target_sample_rate)

        # Light normalization for transcription (NOT for diarization!)
        target_rms = 10 ** (-20.0 / 20)  # -20dB
        current_rms = np.sqrt(np.mean(audio ** 2))
        if current_rms > 1e-10:
            gain = target_rms / current_rms
            # Limit gain to prevent over-amplification
            gain = min(gain, 10.0)
            audio = audio * gain
            audio = np.clip(audio, -1.0, 1.0)

        # Ensure output path
        if output_path is None:
            output_path = tempfile.mktemp(suffix="_transcription.wav")

        # Save processed audio
        self._save_audio(audio, self.config.target_sample_rate, output_path)

        return output_path

    def analyze_quality(self, audio_path: str) -> AudioQualityReport:
        """
        Analyze audio quality without processing.

        Use this to check if audio is suitable for diarization
        before running the full pipeline.

        Args:
            audio_path: Path to audio file

        Returns:
            AudioQualityReport with detailed analysis
        """
        audio, sample_rate = self._load_audio(audio_path)
        return self.quality_analyzer.analyze(audio, sample_rate)

    def validate_for_diarization(self, audio_path: str) -> Tuple[bool, AudioQualityReport]:
        """
        Validate if audio is suitable for accurate diarization.

        Args:
            audio_path: Path to audio file

        Returns:
            Tuple of (is_suitable, quality_report)
            is_suitable is True if audio quality is acceptable for diarization
        """
        report = self.analyze_quality(audio_path)

        # Audio is suitable if quality is at least "fair" and no critical issues
        is_suitable = (
            report.overall_quality in [
                AudioQualityLevel.EXCELLENT,
                AudioQualityLevel.GOOD,
                AudioQualityLevel.FAIR
            ] and not report.has_critical_issues
        )

        return is_suitable, report

    def _load_audio(self, audio_path: str) -> Tuple[np.ndarray, int]:
        """Load audio file using available backend."""
        if SOUNDFILE_AVAILABLE:
            audio, sample_rate = sf.read(audio_path, dtype='float32')
            return audio, sample_rate
        elif PYDUB_AVAILABLE:
            audio_segment = AudioSegment.from_file(audio_path)
            sample_rate = audio_segment.frame_rate
            samples = np.array(audio_segment.get_array_of_samples(), dtype=np.float32)
            samples = samples / (2 ** (audio_segment.sample_width * 8 - 1))
            if audio_segment.channels == 2:
                samples = samples.reshape((-1, 2))
            return samples, sample_rate
        elif TORCHAUDIO_AVAILABLE:
            waveform, sample_rate = torchaudio.load(audio_path)
            return waveform.numpy().T.squeeze(), sample_rate
        else:
            raise RuntimeError(
                "No audio loading library available. "
                "Install soundfile, pydub, or torchaudio."
            )

    def _save_audio(self, audio: np.ndarray, sample_rate: int, output_path: str) -> None:
        """Save audio to WAV file."""
        # Ensure audio is float32 and in valid range
        audio = np.clip(audio, -1.0, 1.0).astype(np.float32)

        if SOUNDFILE_AVAILABLE:
            sf.write(output_path, audio, sample_rate)
        elif TORCHAUDIO_AVAILABLE:
            waveform = torch.from_numpy(audio).unsqueeze(0) if len(audio.shape) == 1 else torch.from_numpy(audio.T)
            torchaudio.save(output_path, waveform, sample_rate)
        else:
            raise RuntimeError("No audio saving library available.")

    def _resample(self, audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Resample audio to target sample rate."""
        if TORCHAUDIO_AVAILABLE:
            resampler = torchaudio.transforms.Resample(orig_sr, target_sr)
            audio_tensor = torch.from_numpy(audio).float()
            if len(audio_tensor.shape) == 1:
                audio_tensor = audio_tensor.unsqueeze(0)
            resampled = resampler(audio_tensor)
            return resampled.squeeze().numpy()
        else:
            # Simple linear interpolation fallback
            duration = len(audio) / orig_sr
            target_length = int(duration * target_sr)
            indices = np.linspace(0, len(audio) - 1, target_length)
            return np.interp(indices, np.arange(len(audio)), audio)

    def _soft_peak_limit(self, audio: np.ndarray, threshold: float) -> np.ndarray:
        """
        Apply soft peak limiting to prevent clipping.

        Uses soft knee compression above threshold to preserve dynamics
        while preventing peaks from exceeding the limit.
        """
        # Find samples above threshold
        above_threshold = np.abs(audio) > threshold

        if not np.any(above_threshold):
            return audio

        result = audio.copy()

        # Apply soft compression to samples above threshold
        # Using tanh-based soft clipper
        for i in np.where(above_threshold)[0]:
            sample = audio[i]
            sign = np.sign(sample)
            magnitude = np.abs(sample)
            # Compress magnitude above threshold using tanh
            excess = magnitude - threshold
            compressed_excess = np.tanh(excess * 2) * (1 - threshold)
            result[i] = sign * (threshold + compressed_excess)

        return result

    def _simple_noise_gate(
        self,
        audio: np.ndarray,
        sample_rate: int,
        threshold_db: float = -40.0
    ) -> np.ndarray:
        """
        Apply simple noise gate for transcription.

        Note: This is used for TRANSCRIPTION only, not diarization.
        Noise gating can harm speaker embeddings.
        """
        threshold = 10 ** (threshold_db / 20)

        # Frame-based noise gate
        frame_size = int(0.02 * sample_rate)  # 20ms frames
        hop_size = frame_size // 2

        result = audio.copy()

        for i in range(0, len(audio) - frame_size, hop_size):
            frame = audio[i:i + frame_size]
            rms = np.sqrt(np.mean(frame ** 2))

            if rms < threshold:
                # Fade out this frame
                fade = np.linspace(1.0, 0.1, frame_size)
                result[i:i + frame_size] *= fade

        return result


# ============================================================================
# Convenience Functions
# ============================================================================

def prepare_audio_for_diarization(
    audio_path: str,
    output_path: Optional[str] = None,
    validate_quality: bool = True
) -> Tuple[str, Optional[AudioQualityReport]]:
    """
    Convenience function to prepare audio for diarization.

    Args:
        audio_path: Path to input audio file
        output_path: Optional path for processed output
        validate_quality: Whether to perform quality validation

    Returns:
        Tuple of (processed_audio_path, quality_report or None)
    """
    preprocessor = DiarizationAudioPreprocessor()

    if validate_quality:
        return preprocessor.prepare_for_diarization(audio_path, output_path)
    else:
        # Skip quality validation
        config = DiarizationPreprocessingConfig(validate_quality=False)
        preprocessor = DiarizationAudioPreprocessor(config)
        processed_path, _ = preprocessor.prepare_for_diarization(audio_path, output_path)
        return processed_path, None


def check_audio_quality(audio_path: str) -> AudioQualityReport:
    """
    Check audio quality for diarization suitability.

    Args:
        audio_path: Path to audio file

    Returns:
        AudioQualityReport with detailed analysis
    """
    preprocessor = DiarizationAudioPreprocessor()
    return preprocessor.analyze_quality(audio_path)


# ============================================================================
# CLI Interface
# ============================================================================

def main():
    """Command-line interface for diarization audio preprocessing."""
    parser = argparse.ArgumentParser(
        description="Audio Preprocessing Pipeline Optimized for Speaker Diarization",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Prepare audio for diarization (minimal processing)
  python diarization_audio_preprocessor.py prepare audio.wav --output diarization_ready.wav

  # Check audio quality without processing
  python diarization_audio_preprocessor.py analyze audio.wav

  # Prepare for transcription (with noise reduction)
  python diarization_audio_preprocessor.py transcribe audio.wav --output transcription_ready.wav

  # Validate audio suitability for diarization
  python diarization_audio_preprocessor.py validate audio.wav

Key Principles:
  - MINIMAL processing for diarization to preserve speaker embeddings
  - NO aggressive noise suppression (destroys speaker characteristics)
  - NO echo cancellation (destroys speaker characteristics)
  - NO loudness normalization (destroys speaker characteristics)
  - Audio quality validation to warn about issues proactively
        """
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Prepare command (for diarization)
    prepare_parser = subparsers.add_parser(
        "prepare",
        help="Prepare audio for diarization (minimal processing)"
    )
    prepare_parser.add_argument("audio_file", help="Input audio file")
    prepare_parser.add_argument("--output", "-o", help="Output file path")
    prepare_parser.add_argument(
        "--no-quality-check",
        action="store_true",
        help="Skip quality validation"
    )

    # Analyze command
    analyze_parser = subparsers.add_parser(
        "analyze",
        help="Analyze audio quality without processing"
    )
    analyze_parser.add_argument("audio_file", help="Input audio file")
    analyze_parser.add_argument(
        "--format", "-f",
        choices=["json", "text"],
        default="text",
        help="Output format"
    )

    # Transcribe command (for transcription)
    transcribe_parser = subparsers.add_parser(
        "transcribe",
        help="Prepare audio for transcription (may include noise reduction)"
    )
    transcribe_parser.add_argument("audio_file", help="Input audio file")
    transcribe_parser.add_argument("--output", "-o", help="Output file path")
    transcribe_parser.add_argument(
        "--no-noise-reduction",
        action="store_true",
        help="Skip noise reduction"
    )

    # Validate command
    validate_parser = subparsers.add_parser(
        "validate",
        help="Validate audio suitability for diarization"
    )
    validate_parser.add_argument("audio_file", help="Input audio file")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    try:
        preprocessor = DiarizationAudioPreprocessor()

        if args.command == "prepare":
            print(f"Preparing audio for diarization: {args.audio_file}", file=sys.stderr)

            output_path, quality_report = preprocessor.prepare_for_diarization(
                args.audio_file,
                args.output
            )

            print(f"Processed audio saved to: {output_path}")

            if quality_report and not args.no_quality_check:
                print(f"\nQuality Assessment: {quality_report.overall_quality.value.upper()}")
                print(f"Diarization Suitability: {quality_report.diarization_suitability:.1%}")

                if quality_report.has_warnings:
                    print("\nWarnings:")
                    for warning in quality_report.warnings:
                        icon = "!" if warning.severity == "error" else "⚠" if warning.severity == "warning" else "ℹ"
                        print(f"  {icon} {warning.message}")
                        if warning.recommendation:
                            print(f"    → {warning.recommendation}")

        elif args.command == "analyze":
            quality_report = preprocessor.analyze_quality(args.audio_file)

            if args.format == "json":
                print(json.dumps(quality_report.to_dict(), indent=2))
            else:
                print(f"Audio Quality Analysis: {args.audio_file}")
                print("=" * 60)
                print(f"Overall Quality: {quality_report.overall_quality.value.upper()}")
                print(f"Diarization Suitability: {quality_report.diarization_suitability:.1%}")
                print()
                print("Metrics:")
                print(f"  Peak Amplitude: {quality_report.peak_amplitude:.4f}")
                print(f"  RMS Level: {quality_report.rms_level_db:.1f} dB")
                print(f"  Noise Floor: {quality_report.noise_floor_db:.1f} dB")
                print(f"  Estimated SNR: {quality_report.estimated_snr_db:.1f} dB")
                print(f"  Dynamic Range: {quality_report.dynamic_range_db:.1f} dB")
                print(f"  Clipping: {quality_report.clipping_percentage:.2f}%")
                print(f"  Silence: {quality_report.silence_percentage:.1f}%")
                print()
                print(f"Duration: {quality_report.duration_seconds:.2f}s")
                print(f"Sample Rate: {quality_report.sample_rate} Hz")

                if quality_report.has_warnings:
                    print()
                    print("Warnings:")
                    for warning in quality_report.warnings:
                        icon = "!" if warning.severity == "error" else "⚠" if warning.severity == "warning" else "ℹ"
                        print(f"  {icon} [{warning.issue.value}] {warning.message}")

        elif args.command == "transcribe":
            print(f"Preparing audio for transcription: {args.audio_file}", file=sys.stderr)

            output_path = preprocessor.prepare_for_transcription(
                args.audio_file,
                args.output,
                apply_noise_reduction=not args.no_noise_reduction
            )

            print(f"Processed audio saved to: {output_path}")

        elif args.command == "validate":
            is_suitable, quality_report = preprocessor.validate_for_diarization(args.audio_file)

            if is_suitable:
                print(f"✓ Audio is suitable for diarization")
                print(f"  Quality: {quality_report.overall_quality.value}")
                print(f"  Suitability Score: {quality_report.diarization_suitability:.1%}")
            else:
                print(f"✗ Audio may have issues affecting diarization accuracy")
                print(f"  Quality: {quality_report.overall_quality.value}")
                print(f"  Suitability Score: {quality_report.diarization_suitability:.1%}")

                if quality_report.has_warnings:
                    print("\nIssues detected:")
                    for warning in quality_report.warnings:
                        print(f"  - {warning.message}")

            # Exit with appropriate code
            sys.exit(0 if is_suitable else 1)

    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
