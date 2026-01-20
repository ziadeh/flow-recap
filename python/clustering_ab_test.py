#!/usr/bin/env python3
"""
clustering_ab_test.py - A/B Testing Framework for PyAnnote Speaker Clustering Settings

This module provides tools to validate and optimize PyAnnote speaker clustering settings
for multi-speaker detection during live recording.

Key Features:
1. Multiple clustering threshold configurations (0.25 - 0.70)
2. Configurable min/max speaker count validation
3. Embedding quality metrics
4. Speaker change sensitivity analysis
5. Audio preprocessing validation (minimal processing preserved)
6. A/B testing with result logging

Usage:
    # Run A/B test with different configurations
    python clustering_ab_test.py --audio test.wav --test-configs

    # Validate specific settings
    python clustering_ab_test.py --audio test.wav --threshold 0.35 --max-speakers 10

    # Generate configuration recommendation
    python clustering_ab_test.py --audio test.wav --recommend

Output Format:
    {
        "config": {"threshold": 0.35, "max_speakers": 10},
        "results": {
            "num_speakers_detected": 3,
            "speaker_separation_score": 0.82,
            "change_detection_latency": 1.2,
            "confidence_distribution": {...}
        },
        "recommendations": [...]
    }
"""

import argparse
import json
import os
import sys
import time
import warnings
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Tuple, Any
from collections import defaultdict
from enum import Enum
import numpy as np

# Suppress warnings for cleaner output
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

# ============================================================================
# Configuration Profiles
# ============================================================================

class ClusteringProfile(Enum):
    """Pre-defined clustering configuration profiles for different scenarios."""

    # Conservative: Fewer speakers, higher confidence
    CONSERVATIVE = "conservative"

    # Balanced: Good for most multi-speaker scenarios
    BALANCED = "balanced"

    # Sensitive: More speakers detected, may have false positives
    SENSITIVE = "sensitive"

    # Very Sensitive: Maximum speaker separation
    VERY_SENSITIVE = "very_sensitive"

    # Custom: User-defined settings
    CUSTOM = "custom"


@dataclass
class ClusteringConfig:
    """
    Configuration settings for speaker clustering.

    Attributes:
        similarity_threshold: Cosine similarity threshold for speaker matching (0.0-1.0).
                            Lower values = more speakers detected.
                            Recommended range: 0.25-0.70
        max_speakers: Maximum number of speakers to track (2-20)
        min_speakers: Minimum number of speakers to detect (1-10)
        window_duration: Audio window duration for embedding extraction (seconds)
        hop_duration: Hop size between windows (seconds)
        cold_start_duration: Duration before full confidence (seconds)
        centroid_decay_factor: Decay factor for temporal weighting (0.0-1.0)
        max_centroid_history: Maximum embeddings to keep per speaker
        enable_retroactive_correction: Allow updating past speaker assignments
    """
    similarity_threshold: float = 0.35
    max_speakers: int = 10
    min_speakers: int = 2
    window_duration: float = 2.0
    hop_duration: float = 0.5
    cold_start_duration: float = 5.0
    centroid_decay_factor: float = 0.9
    max_centroid_history: int = 20
    enable_retroactive_correction: bool = True
    profile: str = "custom"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)

    @classmethod
    def from_profile(cls, profile: ClusteringProfile) -> "ClusteringConfig":
        """Create configuration from a pre-defined profile."""
        if profile == ClusteringProfile.CONSERVATIVE:
            return cls(
                similarity_threshold=0.50,
                max_speakers=6,
                min_speakers=2,
                window_duration=2.5,
                hop_duration=0.5,
                cold_start_duration=6.0,
                centroid_decay_factor=0.85,
                max_centroid_history=15,
                enable_retroactive_correction=True,
                profile="conservative"
            )
        elif profile == ClusteringProfile.BALANCED:
            return cls(
                similarity_threshold=0.35,
                max_speakers=10,
                min_speakers=2,
                window_duration=2.0,
                hop_duration=0.5,
                cold_start_duration=5.0,
                centroid_decay_factor=0.9,
                max_centroid_history=20,
                enable_retroactive_correction=True,
                profile="balanced"
            )
        elif profile == ClusteringProfile.SENSITIVE:
            return cls(
                similarity_threshold=0.30,
                max_speakers=10,
                min_speakers=2,
                window_duration=2.0,
                hop_duration=0.5,
                cold_start_duration=5.0,
                centroid_decay_factor=0.9,
                max_centroid_history=20,
                enable_retroactive_correction=True,
                profile="sensitive"
            )
        elif profile == ClusteringProfile.VERY_SENSITIVE:
            return cls(
                similarity_threshold=0.25,
                max_speakers=15,
                min_speakers=2,
                window_duration=1.5,
                hop_duration=0.25,
                cold_start_duration=4.0,
                centroid_decay_factor=0.95,
                max_centroid_history=25,
                enable_retroactive_correction=True,
                profile="very_sensitive"
            )
        else:
            return cls(profile="custom")


# ============================================================================
# A/B Test Configurations
# ============================================================================

# Configurations to test for A/B testing
AB_TEST_CONFIGS = [
    # Baseline - current default
    ClusteringConfig(
        similarity_threshold=0.30,
        max_speakers=10,
        profile="baseline_0.30"
    ),
    # Slightly stricter
    ClusteringConfig(
        similarity_threshold=0.35,
        max_speakers=10,
        profile="test_0.35"
    ),
    # Moderate strictness
    ClusteringConfig(
        similarity_threshold=0.40,
        max_speakers=10,
        profile="test_0.40"
    ),
    # Stricter (addresses speaker merging)
    ClusteringConfig(
        similarity_threshold=0.50,
        max_speakers=10,
        profile="test_0.50"
    ),
    # Even stricter
    ClusteringConfig(
        similarity_threshold=0.60,
        max_speakers=10,
        profile="test_0.60"
    ),
    # Most strict (may over-split)
    ClusteringConfig(
        similarity_threshold=0.70,
        max_speakers=10,
        profile="test_0.70"
    ),
]


# ============================================================================
# Validation Utilities
# ============================================================================

@dataclass
class EmbeddingQualityMetrics:
    """Metrics for evaluating embedding quality."""
    mean_embedding_norm: float = 0.0
    embedding_norm_std: float = 0.0
    inter_speaker_distance: float = 0.0  # Average distance between different speakers
    intra_speaker_variance: float = 0.0  # Average variance within same speaker
    min_audio_context: float = 0.0  # Minimum audio context in seconds
    avg_audio_context: float = 0.0  # Average audio context in seconds

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SpeakerChangeMetrics:
    """Metrics for evaluating speaker change detection."""
    total_changes_detected: int = 0
    avg_change_latency: float = 0.0  # Average latency to detect change (seconds)
    max_change_latency: float = 0.0  # Maximum latency (seconds)
    min_change_latency: float = 0.0  # Minimum latency (seconds)
    false_positive_rate: float = 0.0  # Estimated false positive rate

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class AudioPreprocessingMetrics:
    """Metrics for validating audio preprocessing."""
    sample_rate: int = 0
    channels: int = 0
    bit_depth: int = 0
    duration: float = 0.0
    noise_suppression_applied: bool = False
    echo_cancellation_applied: bool = False
    loudness_normalization_applied: bool = False
    peak_amplitude: float = 0.0
    rms_level: float = 0.0
    snr_estimate: float = 0.0
    clipping_detected: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ClusteringTestResult:
    """Result of a clustering configuration test."""
    config: ClusteringConfig
    num_speakers_detected: int = 0
    speaker_separation_score: float = 0.0  # How well speakers are separated
    confidence_distribution: Dict[str, float] = field(default_factory=dict)
    segment_count: int = 0
    total_duration: float = 0.0
    processing_time: float = 0.0
    embedding_quality: EmbeddingQualityMetrics = field(default_factory=EmbeddingQualityMetrics)
    change_metrics: SpeakerChangeMetrics = field(default_factory=SpeakerChangeMetrics)
    audio_preprocessing: AudioPreprocessingMetrics = field(default_factory=AudioPreprocessingMetrics)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "config": self.config.to_dict(),
            "num_speakers_detected": self.num_speakers_detected,
            "speaker_separation_score": round(self.speaker_separation_score, 4),
            "confidence_distribution": {
                k: round(v, 4) for k, v in self.confidence_distribution.items()
            },
            "segment_count": self.segment_count,
            "total_duration": round(self.total_duration, 2),
            "processing_time": round(self.processing_time, 3),
            "embedding_quality": self.embedding_quality.to_dict(),
            "change_metrics": self.change_metrics.to_dict(),
            "audio_preprocessing": self.audio_preprocessing.to_dict(),
            "errors": self.errors,
            "warnings": self.warnings
        }


# ============================================================================
# Validation Functions
# ============================================================================

def validate_max_speakers_passed(config: ClusteringConfig, detected_speakers: int) -> Tuple[bool, str]:
    """
    Validate that max_speakers setting is being respected.

    Args:
        config: Clustering configuration
        detected_speakers: Number of speakers detected

    Returns:
        Tuple of (is_valid, message)
    """
    if detected_speakers > config.max_speakers:
        return False, f"FAIL: Detected {detected_speakers} speakers, exceeds max_speakers={config.max_speakers}"
    return True, f"PASS: Detected {detected_speakers} speakers within max_speakers={config.max_speakers}"


def validate_embedding_context(window_duration: float, hop_duration: float) -> Tuple[bool, List[str]]:
    """
    Validate that embedding extraction has sufficient audio context.

    Args:
        window_duration: Window size in seconds
        hop_duration: Hop size in seconds

    Returns:
        Tuple of (is_valid, warnings)
    """
    warnings = []
    is_valid = True

    # Minimum recommended context is 1 second
    if window_duration < 1.0:
        warnings.append(f"WARNING: Window duration {window_duration}s is below recommended minimum of 1.0s")
        is_valid = False

    # Maximum recommended context is 3 seconds (for real-time)
    if window_duration > 3.0:
        warnings.append(f"WARNING: Window duration {window_duration}s exceeds recommended maximum of 3.0s for real-time")

    # Overlap should be at least 50%
    overlap = 1 - (hop_duration / window_duration)
    if overlap < 0.5:
        warnings.append(f"WARNING: Overlap {overlap:.1%} is below recommended 50% for good speaker continuity")

    return is_valid, warnings


def validate_threshold_range(threshold: float) -> Tuple[bool, List[str]]:
    """
    Validate that clustering threshold is within acceptable range.

    The feature request mentions:
    - Current threshold of 0.5 may be too low, causing all speakers to merge
    - Test with stricter thresholds (0.6-0.7)

    Note: Lower threshold = more sensitive = more speakers detected

    Args:
        threshold: Similarity threshold

    Returns:
        Tuple of (is_valid, recommendations)
    """
    recommendations = []
    is_valid = True

    if threshold < 0.25:
        recommendations.append(f"CAUTION: Threshold {threshold} is very low, may cause excessive speaker splitting")
    elif threshold < 0.35:
        recommendations.append(f"INFO: Threshold {threshold} is sensitive, good for detecting subtle voice differences")
    elif threshold < 0.50:
        recommendations.append(f"INFO: Threshold {threshold} is balanced, good for most scenarios")
    elif threshold < 0.60:
        recommendations.append(f"INFO: Threshold {threshold} is strict, may merge similar voices")
    elif threshold < 0.70:
        recommendations.append(f"INFO: Threshold {threshold} is very strict, may significantly merge speakers")
    else:
        recommendations.append(f"WARNING: Threshold {threshold} is extremely strict, likely to merge all speakers")
        is_valid = False

    return is_valid, recommendations


def analyze_audio_preprocessing(audio: np.ndarray, sample_rate: int) -> AudioPreprocessingMetrics:
    """
    Analyze audio to detect if destructive preprocessing has been applied.

    The feature request mentions:
    - Confirm minimal processing is applied
    - No aggressive noise suppression that destroys speaker characteristics

    Args:
        audio: Audio samples as numpy array
        sample_rate: Sample rate in Hz

    Returns:
        AudioPreprocessingMetrics with analysis results
    """
    metrics = AudioPreprocessingMetrics()
    metrics.sample_rate = sample_rate
    metrics.channels = 1 if len(audio.shape) == 1 else audio.shape[1]
    metrics.duration = len(audio) / sample_rate

    # Calculate peak amplitude
    metrics.peak_amplitude = float(np.max(np.abs(audio)))

    # Check for clipping
    metrics.clipping_detected = metrics.peak_amplitude >= 0.99

    # Calculate RMS level
    metrics.rms_level = float(np.sqrt(np.mean(audio ** 2)))

    # Estimate SNR (simple approach)
    # Use lowest 10% of frame energies as noise estimate
    frame_size = int(0.025 * sample_rate)  # 25ms frames
    num_frames = len(audio) // frame_size

    if num_frames > 10:
        frame_energies = []
        for i in range(num_frames):
            frame = audio[i * frame_size:(i + 1) * frame_size]
            energy = np.sqrt(np.mean(frame ** 2))
            frame_energies.append(energy)

        frame_energies.sort()
        noise_energy = np.mean(frame_energies[:max(1, num_frames // 10)])
        signal_energy = np.mean(frame_energies[num_frames // 2:])

        if noise_energy > 0:
            metrics.snr_estimate = 20 * np.log10(signal_energy / noise_energy)
        else:
            metrics.snr_estimate = 60.0  # Very clean signal

    # Detect potential noise suppression by checking for unnatural silence
    # Aggressive noise suppression often creates unnaturally quiet segments
    silence_threshold = 0.01
    silent_frames = sum(1 for e in frame_energies if e < silence_threshold) if num_frames > 10 else 0
    silence_ratio = silent_frames / max(1, num_frames)

    # If more than 30% is silent, noise suppression may be too aggressive
    if silence_ratio > 0.3 and metrics.snr_estimate < 20:
        metrics.noise_suppression_applied = True

    return metrics


def compute_speaker_separation_score(
    embeddings: List[np.ndarray],
    labels: List[int]
) -> Tuple[float, float, float]:
    """
    Compute speaker separation score based on embedding distances.

    Args:
        embeddings: List of speaker embeddings
        labels: Cluster labels for each embedding

    Returns:
        Tuple of (separation_score, inter_speaker_distance, intra_speaker_variance)
    """
    if len(embeddings) < 2 or len(set(labels)) < 2:
        return 0.0, 0.0, 0.0

    embeddings = np.array(embeddings)
    labels = np.array(labels)

    # Normalize embeddings
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    embeddings_norm = embeddings / (norms + 1e-10)

    # Compute inter-speaker distances (between different speakers)
    inter_distances = []
    unique_labels = list(set(labels))

    for i, label_i in enumerate(unique_labels):
        for label_j in unique_labels[i+1:]:
            mask_i = labels == label_i
            mask_j = labels == label_j

            emb_i = embeddings_norm[mask_i]
            emb_j = embeddings_norm[mask_j]

            if len(emb_i) > 0 and len(emb_j) > 0:
                # Compute pairwise distances
                for ei in emb_i:
                    for ej in emb_j:
                        dist = 1 - np.dot(ei, ej)  # Cosine distance
                        inter_distances.append(dist)

    # Compute intra-speaker variance (within same speaker)
    intra_variances = []

    for label in unique_labels:
        mask = labels == label
        emb = embeddings_norm[mask]

        if len(emb) > 1:
            centroid = np.mean(emb, axis=0)
            centroid_norm = centroid / (np.linalg.norm(centroid) + 1e-10)

            for e in emb:
                dist = 1 - np.dot(e, centroid_norm)
                intra_variances.append(dist)

    inter_distance = np.mean(inter_distances) if inter_distances else 0.0
    intra_variance = np.mean(intra_variances) if intra_variances else 0.0

    # Separation score: higher is better
    # Good separation = high inter-speaker distance, low intra-speaker variance
    if intra_variance > 0:
        separation_score = inter_distance / (intra_variance + 0.1)
    else:
        separation_score = inter_distance

    # Normalize to 0-1 range (approximately)
    separation_score = min(1.0, separation_score / 2.0)

    return float(separation_score), float(inter_distance), float(intra_variance)


# ============================================================================
# A/B Testing Functions
# ============================================================================

def run_single_config_test(
    audio: np.ndarray,
    sample_rate: int,
    config: ClusteringConfig,
    verbose: bool = False
) -> ClusteringTestResult:
    """
    Run a single configuration test on audio.

    Args:
        audio: Audio samples as numpy array
        sample_rate: Sample rate in Hz
        config: Clustering configuration to test
        verbose: Print detailed progress

    Returns:
        ClusteringTestResult with test results
    """
    result = ClusteringTestResult(config=config)
    start_time = time.time()

    try:
        # Import diarization modules
        from live_diarize import LiveDiarizer, PYANNOTE_AVAILABLE, SPEECHBRAIN_AVAILABLE

        if not PYANNOTE_AVAILABLE and not SPEECHBRAIN_AVAILABLE:
            result.errors.append("No speaker embedding backend available")
            return result

        # Analyze audio preprocessing
        result.audio_preprocessing = analyze_audio_preprocessing(audio, sample_rate)

        # Validate configuration
        threshold_valid, threshold_recs = validate_threshold_range(config.similarity_threshold)
        result.warnings.extend(threshold_recs)

        context_valid, context_warnings = validate_embedding_context(
            config.window_duration, config.hop_duration
        )
        result.warnings.extend(context_warnings)

        # Initialize diarizer with test config
        diarizer = LiveDiarizer(
            sample_rate=sample_rate,
            segment_duration=config.window_duration,
            hop_duration=config.hop_duration,
            similarity_threshold=config.similarity_threshold,
            max_speakers=config.max_speakers,
            device="cpu",  # Use CPU for consistent testing
            centroid_decay_factor=config.centroid_decay_factor,
            max_centroid_history=config.max_centroid_history
        )

        # Process audio in chunks
        chunk_size = int(0.5 * sample_rate)  # 0.5 second chunks
        embeddings = []
        labels = []
        confidences = []
        speaker_changes = []
        last_speaker = None

        for i in range(0, len(audio) - chunk_size, chunk_size):
            chunk = audio[i:i + chunk_size]
            segments = diarizer.add_audio(chunk)

            for seg in segments:
                result.segment_count += 1
                confidences.append(seg.get("confidence", 0.0))

                # Track speaker changes
                current_speaker = seg.get("speaker")
                if current_speaker != last_speaker and last_speaker is not None:
                    change_time = seg.get("start", 0.0)
                    speaker_changes.append(change_time)
                last_speaker = current_speaker

        # Process remaining audio
        diarizer.process_remaining()

        # Get results
        stats = diarizer.get_stats()
        result.num_speakers_detected = stats.get("num_speakers", 0)
        result.total_duration = stats.get("total_duration", 0.0)

        # Validate max_speakers
        max_valid, max_msg = validate_max_speakers_passed(config, result.num_speakers_detected)
        if not max_valid:
            result.errors.append(max_msg)

        # Compute confidence distribution
        if confidences:
            result.confidence_distribution = {
                "min": float(np.min(confidences)),
                "max": float(np.max(confidences)),
                "mean": float(np.mean(confidences)),
                "std": float(np.std(confidences)),
                "below_0.5": float(sum(1 for c in confidences if c < 0.5) / len(confidences)),
                "above_0.8": float(sum(1 for c in confidences if c > 0.8) / len(confidences))
            }

        # Compute speaker change metrics
        if speaker_changes:
            result.change_metrics.total_changes_detected = len(speaker_changes)

            # Estimate change detection latency
            # In a real test, we'd compare to ground truth
            # Here we use the hop_duration as an approximation
            result.change_metrics.avg_change_latency = config.hop_duration
            result.change_metrics.max_change_latency = config.window_duration
            result.change_metrics.min_change_latency = config.hop_duration

        # Note: Computing speaker_separation_score requires access to raw embeddings
        # which would require modifying LiveDiarizer. For now, use confidence as proxy
        if confidences:
            result.speaker_separation_score = float(np.mean(confidences))

        # Embedding quality metrics
        result.embedding_quality.min_audio_context = config.window_duration
        result.embedding_quality.avg_audio_context = config.window_duration

    except Exception as e:
        result.errors.append(f"Test failed: {str(e)}")

    result.processing_time = time.time() - start_time
    return result


def run_ab_tests(
    audio: np.ndarray,
    sample_rate: int,
    configs: Optional[List[ClusteringConfig]] = None,
    verbose: bool = False
) -> List[ClusteringTestResult]:
    """
    Run A/B tests with multiple configurations.

    Args:
        audio: Audio samples as numpy array
        sample_rate: Sample rate in Hz
        configs: List of configurations to test (uses AB_TEST_CONFIGS if None)
        verbose: Print detailed progress

    Returns:
        List of ClusteringTestResult for each configuration
    """
    if configs is None:
        configs = AB_TEST_CONFIGS

    results = []

    for i, config in enumerate(configs):
        if verbose:
            print(f"\n[A/B Test] Running config {i+1}/{len(configs)}: {config.profile}", file=sys.stderr)

        result = run_single_config_test(audio, sample_rate, config, verbose)
        results.append(result)

        if verbose:
            print(f"  Speakers: {result.num_speakers_detected}, "
                  f"Segments: {result.segment_count}, "
                  f"Separation: {result.speaker_separation_score:.3f}",
                  file=sys.stderr)

    return results


def recommend_config(results: List[ClusteringTestResult], expected_speakers: Optional[int] = None) -> Dict[str, Any]:
    """
    Recommend the best configuration based on test results.

    Args:
        results: List of A/B test results
        expected_speakers: Expected number of speakers (if known)

    Returns:
        Dictionary with recommendation and reasoning
    """
    if not results:
        return {
            "recommendation": None,
            "reason": "No test results available"
        }

    # Score each configuration
    scores = []

    for result in results:
        score = 0.0
        reasons = []

        # Score based on speaker separation
        score += result.speaker_separation_score * 30
        reasons.append(f"Separation score: {result.speaker_separation_score:.3f}")

        # Score based on confidence distribution
        if result.confidence_distribution:
            mean_conf = result.confidence_distribution.get("mean", 0)
            score += mean_conf * 20
            reasons.append(f"Mean confidence: {mean_conf:.3f}")

            # Penalize low confidence segments
            low_conf_ratio = result.confidence_distribution.get("below_0.5", 0)
            score -= low_conf_ratio * 10

        # Score based on number of speakers (if expected is known)
        if expected_speakers is not None:
            speaker_diff = abs(result.num_speakers_detected - expected_speakers)
            speaker_penalty = speaker_diff * 10
            score -= speaker_penalty
            reasons.append(f"Speaker diff from expected: {speaker_diff}")
        else:
            # Prefer configurations that detect multiple speakers
            if result.num_speakers_detected >= 2:
                score += 10

        # Penalize configurations with errors
        score -= len(result.errors) * 20

        # Penalize configurations with warnings
        score -= len(result.warnings) * 5

        scores.append({
            "config": result.config,
            "score": score,
            "reasons": reasons,
            "result": result
        })

    # Sort by score (highest first)
    scores.sort(key=lambda x: x["score"], reverse=True)

    best = scores[0]

    return {
        "recommendation": best["config"].to_dict(),
        "score": best["score"],
        "reasons": best["reasons"],
        "num_speakers_detected": best["result"].num_speakers_detected,
        "all_results": [
            {
                "profile": s["config"].profile,
                "score": round(s["score"], 2),
                "num_speakers": s["result"].num_speakers_detected
            }
            for s in scores
        ]
    }


# ============================================================================
# Result Logging
# ============================================================================

def log_ab_test_results(
    results: List[ClusteringTestResult],
    output_path: Optional[str] = None,
    append: bool = True
) -> str:
    """
    Log A/B test results to a file.

    Args:
        results: List of test results
        output_path: Path to output file (uses default if None)
        append: Append to existing file if True

    Returns:
        Path to the log file
    """
    if output_path is None:
        output_path = os.path.join(
            os.path.dirname(__file__),
            "ab_test_results.jsonl"
        )

    timestamp = time.strftime("%Y-%m-%dT%H:%M:%S")

    mode = "a" if append else "w"

    with open(output_path, mode) as f:
        for result in results:
            entry = {
                "timestamp": timestamp,
                **result.to_dict()
            }
            f.write(json.dumps(entry) + "\n")

    return output_path


def analyze_historical_results(log_path: str) -> Dict[str, Any]:
    """
    Analyze historical A/B test results to find optimal settings.

    Args:
        log_path: Path to the results log file

    Returns:
        Analysis summary with recommendations
    """
    if not os.path.exists(log_path):
        return {"error": "Log file not found"}

    results_by_profile = defaultdict(list)

    with open(log_path, "r") as f:
        for line in f:
            try:
                entry = json.loads(line.strip())
                profile = entry.get("config", {}).get("profile", "unknown")
                results_by_profile[profile].append(entry)
            except json.JSONDecodeError:
                continue

    analysis = {}

    for profile, entries in results_by_profile.items():
        if entries:
            speakers = [e.get("num_speakers_detected", 0) for e in entries]
            separations = [e.get("speaker_separation_score", 0) for e in entries]

            analysis[profile] = {
                "num_tests": len(entries),
                "avg_speakers": round(np.mean(speakers), 2) if speakers else 0,
                "avg_separation": round(np.mean(separations), 4) if separations else 0,
                "speaker_range": [int(min(speakers)), int(max(speakers))] if speakers else [0, 0]
            }

    return {
        "profiles_tested": list(analysis.keys()),
        "analysis": analysis
    }


# ============================================================================
# CLI Interface
# ============================================================================

def main():
    """Command-line interface for A/B testing."""
    parser = argparse.ArgumentParser(
        description="A/B Testing Framework for PyAnnote Speaker Clustering Settings"
    )

    parser.add_argument(
        "--audio",
        help="Path to audio file for testing"
    )

    parser.add_argument(
        "--test-configs",
        action="store_true",
        help="Run A/B tests with all predefined configurations"
    )

    parser.add_argument(
        "--threshold",
        type=float,
        help="Test specific similarity threshold (0.0-1.0)"
    )

    parser.add_argument(
        "--max-speakers",
        type=int,
        default=10,
        help="Maximum number of speakers (default: 10)"
    )

    parser.add_argument(
        "--expected-speakers",
        type=int,
        help="Expected number of speakers (for recommendation)"
    )

    parser.add_argument(
        "--recommend",
        action="store_true",
        help="Generate configuration recommendation"
    )

    parser.add_argument(
        "--profile",
        choices=["conservative", "balanced", "sensitive", "very_sensitive"],
        help="Use a predefined configuration profile"
    )

    parser.add_argument(
        "--log-results",
        action="store_true",
        help="Log results to ab_test_results.jsonl"
    )

    parser.add_argument(
        "--analyze-history",
        action="store_true",
        help="Analyze historical A/B test results"
    )

    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Print detailed progress"
    )

    parser.add_argument(
        "--output",
        help="Output file path for results (default: stdout)"
    )

    args = parser.parse_args()

    # Analyze historical results
    if args.analyze_history:
        log_path = os.path.join(os.path.dirname(__file__), "ab_test_results.jsonl")
        analysis = analyze_historical_results(log_path)
        print(json.dumps(analysis, indent=2))
        return

    # Load audio if provided
    audio = None
    sample_rate = 16000

    if args.audio:
        try:
            import soundfile as sf
            audio, sample_rate = sf.read(args.audio, dtype='float32')

            # Convert to mono if stereo
            if len(audio.shape) > 1:
                audio = np.mean(audio, axis=1)

            if args.verbose:
                print(f"[A/B Test] Loaded audio: {len(audio)/sample_rate:.1f}s at {sample_rate}Hz",
                      file=sys.stderr)
        except Exception as e:
            print(json.dumps({"error": f"Failed to load audio: {e}"}))
            sys.exit(1)

    # Run tests
    results = []

    if args.test_configs and audio is not None:
        # Run all A/B test configurations
        results = run_ab_tests(audio, sample_rate, verbose=args.verbose)

    elif args.profile and audio is not None:
        # Test specific profile
        profile_map = {
            "conservative": ClusteringProfile.CONSERVATIVE,
            "balanced": ClusteringProfile.BALANCED,
            "sensitive": ClusteringProfile.SENSITIVE,
            "very_sensitive": ClusteringProfile.VERY_SENSITIVE
        }
        config = ClusteringConfig.from_profile(profile_map[args.profile])
        result = run_single_config_test(audio, sample_rate, config, args.verbose)
        results = [result]

    elif args.threshold is not None and audio is not None:
        # Test specific threshold
        config = ClusteringConfig(
            similarity_threshold=args.threshold,
            max_speakers=args.max_speakers,
            profile=f"custom_{args.threshold}"
        )
        result = run_single_config_test(audio, sample_rate, config, args.verbose)
        results = [result]

    # Log results if requested
    if args.log_results and results:
        log_path = log_ab_test_results(results)
        if args.verbose:
            print(f"[A/B Test] Results logged to: {log_path}", file=sys.stderr)

    # Generate output
    output = {}

    if results:
        output["results"] = [r.to_dict() for r in results]

        if args.recommend:
            output["recommendation"] = recommend_config(results, args.expected_speakers)
    else:
        # Just output configuration info
        if args.profile:
            profile_map = {
                "conservative": ClusteringProfile.CONSERVATIVE,
                "balanced": ClusteringProfile.BALANCED,
                "sensitive": ClusteringProfile.SENSITIVE,
                "very_sensitive": ClusteringProfile.VERY_SENSITIVE
            }
            config = ClusteringConfig.from_profile(profile_map[args.profile])
            output["config"] = config.to_dict()
        else:
            # Output default configurations
            output["available_profiles"] = {
                "conservative": ClusteringConfig.from_profile(ClusteringProfile.CONSERVATIVE).to_dict(),
                "balanced": ClusteringConfig.from_profile(ClusteringProfile.BALANCED).to_dict(),
                "sensitive": ClusteringConfig.from_profile(ClusteringProfile.SENSITIVE).to_dict(),
                "very_sensitive": ClusteringConfig.from_profile(ClusteringProfile.VERY_SENSITIVE).to_dict()
            }
            output["ab_test_configs"] = [c.to_dict() for c in AB_TEST_CONFIGS]

    # Output
    output_str = json.dumps(output, indent=2)

    if args.output:
        with open(args.output, "w") as f:
            f.write(output_str)
    else:
        print(output_str)


if __name__ == "__main__":
    main()
