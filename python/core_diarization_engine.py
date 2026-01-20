#!/usr/bin/env python3
"""
core_diarization_engine.py - Core Speaker Diarization Engine

This module implements a MANDATORY speaker diarization engine using pyannote.audio
that MUST be executed BEFORE transcription in the audio processing pipeline.

KEY REQUIREMENTS:
1. BLOCKING REQUIREMENT: System must fail explicitly if diarization cannot be performed
2. Uses pyannote.audio for speaker embeddings and change detection
3. Processes audio in near-real-time chunks (1-3 second windows)
4. Handles 2-5 unknown speakers on single mixed audio streams
5. Outputs structured speaker segments with speaker_id, start_time, end_time, confidence

Audio Processing Pipeline Order:
    Audio Capture -> DIARIZATION (this module) -> Structured Segments -> Transcription -> UI

Usage:
    from core_diarization_engine import CoreDiarizationEngine, DiarizationError

    # Initialize engine - will raise DiarizationError if pyannote not available
    engine = CoreDiarizationEngine(sample_rate=16000, min_speakers=2, max_speakers=5)

    # Process audio chunks (returns structured segments)
    segments = engine.process_audio_chunk(audio_data)

    # Each segment contains:
    # {
    #     "speaker_id": "SPEAKER_0",
    #     "start_time": 0.0,
    #     "end_time": 2.5,
    #     "confidence": 0.92
    # }
"""

import json
import sys
import os
import warnings
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Any
from collections import defaultdict
import time

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

# PyTorch 2.6+ compatibility - allow safe model loading
try:
    import typing
    import collections
    import torch
    import torch.serialization
    from omegaconf import DictConfig, ListConfig
    from omegaconf.base import ContainerMetadata
    safe_globals = [DictConfig, ListConfig, ContainerMetadata, typing.Any, list, dict, tuple, set, collections.defaultdict]
    try:
        from pyannote.audio.core.model import Specifications
        from pyannote.audio.core.task import Problem, Resolution
        safe_globals.extend([Specifications, Problem, Resolution])
    except ImportError:
        pass
    torch.serialization.add_safe_globals(safe_globals)
except ImportError:
    pass
except Exception:
    pass


# ============================================================================
# Custom Exceptions
# ============================================================================

class DiarizationError(Exception):
    """
    Exception raised when diarization cannot be performed.

    This is a BLOCKING error - the system must fail explicitly when diarization
    is required but cannot be performed.
    """
    def __init__(self, message: str, error_code: str = "DIARIZATION_ERROR", details: Optional[Dict] = None):
        self.message = message
        self.error_code = error_code
        self.details = details or {}
        super().__init__(self.message)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "error": True,
            "error_code": self.error_code,
            "message": self.message,
            "details": self.details
        }


class PyannoteNotAvailableError(DiarizationError):
    """Raised when pyannote.audio is not available."""
    def __init__(self, details: Optional[str] = None):
        super().__init__(
            message="BLOCKING REQUIREMENT: pyannote.audio is not available. Speaker diarization cannot be performed.",
            error_code="PYANNOTE_NOT_AVAILABLE",
            details={"reason": details or "pyannote.audio package not installed or not loadable"}
        )


class ModelLoadError(DiarizationError):
    """Raised when the diarization model cannot be loaded."""
    def __init__(self, model_name: str, details: Optional[str] = None):
        super().__init__(
            message=f"BLOCKING REQUIREMENT: Failed to load diarization model '{model_name}'. Speaker diarization cannot be performed.",
            error_code="MODEL_LOAD_ERROR",
            details={"model": model_name, "reason": details or "Unknown error during model loading"}
        )


class InsufficientAudioError(DiarizationError):
    """Raised when there is insufficient audio data for diarization."""
    def __init__(self, received_duration: float, minimum_duration: float):
        super().__init__(
            message=f"Insufficient audio for diarization: received {received_duration:.2f}s, minimum required {minimum_duration:.2f}s",
            error_code="INSUFFICIENT_AUDIO",
            details={"received_duration": received_duration, "minimum_duration": minimum_duration}
        )


# ============================================================================
# Check pyannote.audio availability
# ============================================================================

PYANNOTE_AVAILABLE = False
PYANNOTE_IMPORT_ERROR = None

try:
    from pyannote.audio import Model
    from pyannote.audio import Pipeline
    import torch
    PYANNOTE_AVAILABLE = True
except ImportError as e:
    PYANNOTE_IMPORT_ERROR = str(e)
except Exception as e:
    PYANNOTE_IMPORT_ERROR = str(e)


# ============================================================================
# Data Classes
# ============================================================================

@dataclass
class SpeakerSegment:
    """
    Represents a single speaker segment from diarization.

    This is the PRIMARY OUTPUT of the diarization engine.
    Each segment identifies WHO is speaking at a specific time range.
    """
    speaker_id: str  # e.g., "SPEAKER_0", "SPEAKER_1"
    start_time: float  # Start time in seconds
    end_time: float  # End time in seconds
    confidence: float  # Confidence score (0.0-1.0)

    @property
    def duration(self) -> float:
        """Get segment duration in seconds."""
        return self.end_time - self.start_time

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "speaker_id": self.speaker_id,
            "start_time": round(self.start_time, 3),
            "end_time": round(self.end_time, 3),
            "duration": round(self.duration, 3),
            "confidence": round(self.confidence, 3)
        }


@dataclass
class DiarizationResult:
    """Complete result from a diarization operation."""
    segments: List[SpeakerSegment]
    num_speakers: int
    speaker_ids: List[str]
    audio_duration: float
    processing_time: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "segments": [s.to_dict() for s in self.segments],
            "num_speakers": self.num_speakers,
            "speaker_ids": self.speaker_ids,
            "audio_duration": round(self.audio_duration, 3),
            "processing_time": round(self.processing_time, 3)
        }


@dataclass
class SpeakerEmbedding:
    """Speaker embedding with metadata for clustering."""
    embedding: np.ndarray
    speaker_id: str
    timestamp: float
    segment_duration: float


# ============================================================================
# Core Diarization Engine
# ============================================================================

class CoreDiarizationEngine:
    """
    Core Speaker Diarization Engine using pyannote.audio.

    This engine is a MANDATORY preprocessing stage that MUST be executed
    BEFORE transcription. It extracts speaker embeddings, detects speaker
    changes, performs clustering, and assigns persistent speaker IDs.

    BLOCKING REQUIREMENT: If this engine cannot be initialized or cannot
    perform diarization, the system MUST fail explicitly.

    Pipeline Position:
        Audio Capture -> [THIS ENGINE] -> Structured Segments -> Transcription -> UI

    Attributes:
        sample_rate: Expected audio sample rate (16000 Hz recommended)
        min_speakers: Minimum expected speakers (default: 2)
        max_speakers: Maximum expected speakers (default: 5)
        window_size: Processing window size in seconds (1-3 seconds)
        device: Computation device ('cuda' or 'cpu')
    """

    # Minimum audio duration for meaningful diarization (0.5 seconds)
    MIN_AUDIO_DURATION = 0.5

    # Default processing window size (2 seconds for near-real-time)
    DEFAULT_WINDOW_SIZE = 2.0

    def __init__(
        self,
        sample_rate: int = 16000,
        min_speakers: int = 2,
        max_speakers: int = 5,
        window_size: float = 2.0,
        hop_size: float = 0.5,
        # Lower threshold = more speakers detected (more sensitive to voice differences)
        # FIXED: Lowered from 0.4 to 0.30 for better multi-speaker detection during live recording
        # Typical: same-speaker similarity 0.8-0.95, different speakers 0.2-0.5
        similarity_threshold: float = 0.30,
        device: Optional[str] = None
    ):
        """
        Initialize the Core Diarization Engine.

        BLOCKING: Raises DiarizationError if pyannote.audio is not available.

        Args:
            sample_rate: Audio sample rate in Hz (16000 recommended for speech)
            min_speakers: Minimum number of speakers to detect (2-5 range)
            max_speakers: Maximum number of speakers to detect (2-5 range)
            window_size: Processing window size in seconds (1-3 seconds)
            hop_size: Hop size between windows in seconds
            similarity_threshold: Speaker similarity threshold for clustering (0.0-1.0).
                                 Lower values = more speakers detected.
            device: Computation device ('cuda', 'cpu', or None for auto-detect)

        Raises:
            PyannoteNotAvailableError: If pyannote.audio is not installed
            ModelLoadError: If the embedding model cannot be loaded
        """
        # BLOCKING CHECK: Ensure pyannote.audio is available
        if not PYANNOTE_AVAILABLE:
            raise PyannoteNotAvailableError(PYANNOTE_IMPORT_ERROR)

        self.sample_rate = sample_rate
        self.min_speakers = max(2, min(min_speakers, 5))  # Clamp to 2-5 range
        self.max_speakers = max(2, min(max_speakers, 5))  # Clamp to 2-5 range
        self.window_size = max(1.0, min(window_size, 3.0))  # Clamp to 1-3 seconds
        self.hop_size = hop_size
        self.similarity_threshold = similarity_threshold

        # Calculate buffer sizes
        self.window_samples = int(self.window_size * sample_rate)
        self.hop_samples = int(self.hop_size * sample_rate)

        # Auto-detect device
        if device is None:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device

        # Initialize embedding model
        self._embedding_model = None
        self._embedding_dim = 512  # pyannote embedding dimension

        # =====================================================================
        # Persistent Speaker Profile Cache (maintains identity across chunks)
        # =====================================================================

        # Speaker tracking state
        self._speaker_centroids: Dict[str, np.ndarray] = {}
        self._speaker_counts: Dict[str, int] = defaultdict(int)
        self._next_speaker_id = 0
        self._current_speaker: Optional[str] = None

        # Embedding history per speaker for robust profile building
        self._speaker_embedding_history: Dict[str, List[np.ndarray]] = defaultdict(list)

        # Track profile stability (stable after min_profile_embeddings)
        self._speaker_profile_stable: Dict[str, bool] = defaultdict(bool)

        # Re-identification threshold: matches above this are definitely same speaker
        self._reidentification_threshold = 0.85

        # Minimum match threshold for cold-start protection
        # INCREASED from 0.25 to 0.35 to allow more new speaker creation during cold-start
        self._minimum_match_threshold = 0.35

        # NEW: Threshold below which a voice is DEFINITELY a different speaker
        # even during cold-start. If similarity is below this, always create new speaker
        # INCREASED from 0.20 to 0.30 because processed audio often has higher baseline similarity
        self._definite_new_speaker_threshold = 0.30

        # NEW: Threshold for creating new speakers after cold-start is complete
        self._new_speaker_threshold = 0.40

        # Maximum centroid history to keep
        self._max_centroid_history = 50

        # Minimum embeddings for stable profile
        self._min_profile_embeddings = 3

        # Centroid decay factor
        self._centroid_decay_factor = 0.9

        # Audio buffer for streaming
        self._audio_buffer = np.array([], dtype=np.float32)
        self._processed_samples = 0

        # Track all segments
        self._all_segments: List[SpeakerSegment] = []

        # =====================================================================
        # ADAPTIVE THRESHOLD CALIBRATION STATE
        # =====================================================================
        # Track similarity scores during calibration phase to detect processed audio
        self._calibration_similarities: List[float] = []
        self._is_calibrated = False
        self._is_processed_audio = False
        self._calibration_segments = 8
        self._processed_audio_min_similarity = 0.55
        self._processed_audio_threshold_boost = 0.25

        # Effective thresholds (may be adjusted after calibration)
        self._effective_similarity_threshold = similarity_threshold
        self._effective_definite_new_threshold = self._definite_new_speaker_threshold
        self._effective_new_speaker_threshold = self._new_speaker_threshold
        self._effective_minimum_match_threshold = self._minimum_match_threshold

        # Initialize the model
        self._initialize_model()

        print(f"[CoreDiarization] Engine initialized: sample_rate={sample_rate}, "
              f"speakers={min_speakers}-{max_speakers}, window={window_size}s, device={self.device}",
              file=sys.stderr, flush=True)

    def _get_bundled_model_path(self, model_name: str) -> Optional[str]:
        """
        Check if a model is bundled with the application.

        For packaged Electron apps, models may be bundled in the resources directory.

        Args:
            model_name: Model name like 'pyannote/embedding'

        Returns:
            Path to bundled model if found, None otherwise
        """
        # Try to find bundled models in app resources
        # Packaged apps set this via BUNDLED_MODELS_PATH environment variable
        bundled_path = os.environ.get("BUNDLED_MODELS_PATH")

        if bundled_path and os.path.isdir(bundled_path):
            # Convert model name to path format (pyannote/embedding -> pyannote--embedding)
            model_dir_name = model_name.replace("/", "--")
            model_path = os.path.join(bundled_path, f"models--{model_dir_name}")

            if os.path.isdir(model_path):
                # Check for snapshots directory
                snapshots_path = os.path.join(model_path, "snapshots")
                if os.path.isdir(snapshots_path):
                    snapshots = os.listdir(snapshots_path)
                    if snapshots:
                        return os.path.join(snapshots_path, snapshots[0])

        # Also check standard HuggingFace cache location
        hf_cache = os.environ.get("HF_HOME", os.path.join(os.path.expanduser("~"), ".cache", "huggingface"))
        hub_path = os.path.join(hf_cache, "hub")

        if os.path.isdir(hub_path):
            model_dir_name = model_name.replace("/", "--")
            model_path = os.path.join(hub_path, f"models--{model_dir_name}")

            if os.path.isdir(model_path):
                snapshots_path = os.path.join(model_path, "snapshots")
                if os.path.isdir(snapshots_path):
                    snapshots = os.listdir(snapshots_path)
                    if snapshots:
                        print(f"[CoreDiarization] Found cached model at: {model_path}",
                              file=sys.stderr, flush=True)
                        return os.path.join(snapshots_path, snapshots[0])

        return None

    def _initialize_model(self) -> None:
        """
        Initialize the pyannote.audio embedding model.

        Checks for bundled models first (for packaged apps), then falls back
        to downloading from HuggingFace Hub.

        BLOCKING: Raises ModelLoadError if the model cannot be loaded.
        """
        try:
            hf_token = os.environ.get("HF_TOKEN")
            model_name = "pyannote/embedding"

            # Check for bundled model first
            bundled_path = self._get_bundled_model_path(model_name)

            if bundled_path:
                print(f"[CoreDiarization] Loading bundled model from: {bundled_path}",
                      file=sys.stderr, flush=True)
                # For bundled models, we can load directly from the path
                self._embedding_model = Model.from_pretrained(
                    bundled_path,
                    use_auth_token=hf_token
                )
            else:
                print(f"[CoreDiarization] Downloading model from HuggingFace: {model_name}",
                      file=sys.stderr, flush=True)
                # Load from HuggingFace Hub (will download if needed)
                self._embedding_model = Model.from_pretrained(
                    model_name,
                    use_auth_token=hf_token
                )

            self._embedding_model = self._embedding_model.to(torch.device(self.device))
            self._embedding_model.eval()

            print(f"[CoreDiarization] Loaded pyannote embedding model on {self.device}",
                  file=sys.stderr, flush=True)

        except Exception as e:
            raise ModelLoadError("pyannote/embedding", str(e))

    def _extract_embedding(self, audio: np.ndarray) -> Optional[np.ndarray]:
        """
        Extract speaker embedding from audio segment.

        Args:
            audio: Float32 numpy array of audio samples [-1, 1]

        Returns:
            Speaker embedding vector or None if extraction failed
        """
        if self._embedding_model is None:
            return None

        # Ensure minimum audio length (at least 0.5 seconds)
        min_samples = int(0.5 * self.sample_rate)
        if len(audio) < min_samples:
            # Pad with zeros
            audio = np.pad(audio, (0, min_samples - len(audio)))

        try:
            # Ensure audio is the right shape [1, num_samples]
            if len(audio.shape) == 1:
                audio = audio[np.newaxis, :]

            audio_tensor = torch.from_numpy(audio).float()
            if self.device != "cpu":
                audio_tensor = audio_tensor.to(self.device)

            with torch.no_grad():
                embedding = self._embedding_model(audio_tensor)

            return embedding.cpu().numpy().flatten()

        except Exception as e:
            print(f"[CoreDiarization] Embedding extraction error: {e}", file=sys.stderr, flush=True)
            return None

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Compute cosine similarity between two vectors."""
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(np.dot(a, b) / (norm_a * norm_b))

    def _calibrate_thresholds(self, similarity: float) -> None:
        """
        Calibrate thresholds during the cold-start phase to detect processed audio.

        This method tracks similarity scores during the first N segments.
        If the minimum similarity observed is above a threshold, we're likely
        dealing with processed/compressed audio and need to increase thresholds.

        The key insight is:
        - For live microphone audio: different speakers have similarity 0.2-0.5
        - For processed audio: different speakers have similarity 0.5-0.8

        If we see consistently high similarities in early segments, we boost thresholds.
        """
        if self._is_calibrated:
            return

        # Record this similarity for calibration
        self._calibration_similarities.append(similarity)

        # Wait until we have enough samples
        if len(self._calibration_similarities) < self._calibration_segments:
            return

        # Perform calibration
        min_similarity = min(self._calibration_similarities)
        avg_similarity = sum(self._calibration_similarities) / len(self._calibration_similarities)

        # Log calibration results
        print(f"[CoreDiarization CALIBRATION] Completed with {len(self._calibration_similarities)} samples: "
              f"min_sim={min_similarity:.3f}, avg_sim={avg_similarity:.3f}, "
              f"threshold_for_processed={self._processed_audio_min_similarity}",
              file=sys.stderr, flush=True)

        # Detect processed audio: if minimum similarity is high, audio is likely processed
        if min_similarity >= self._processed_audio_min_similarity:
            self._is_processed_audio = True

            # Boost all thresholds for processed audio
            boost = self._processed_audio_threshold_boost

            self._effective_similarity_threshold = self.similarity_threshold + boost
            self._effective_definite_new_threshold = self._definite_new_speaker_threshold + boost
            self._effective_new_speaker_threshold = self._new_speaker_threshold + boost
            self._effective_minimum_match_threshold = self._minimum_match_threshold + boost

            print(f"[CoreDiarization CALIBRATION] ⚠️ PROCESSED AUDIO DETECTED "
                  f"(min_sim={min_similarity:.3f} >= {self._processed_audio_min_similarity})",
                  file=sys.stderr, flush=True)
            print(f"[CoreDiarization CALIBRATION] Adjusted thresholds: "
                  f"similarity={self._effective_similarity_threshold:.2f}, "
                  f"definite_new={self._effective_definite_new_threshold:.2f}, "
                  f"new_speaker={self._effective_new_speaker_threshold:.2f}, "
                  f"min_match={self._effective_minimum_match_threshold:.2f}",
                  file=sys.stderr, flush=True)
        else:
            print(f"[CoreDiarization CALIBRATION] ✓ Live audio detected "
                  f"(min_sim={min_similarity:.3f} < {self._processed_audio_min_similarity}), "
                  f"using default thresholds",
                  file=sys.stderr, flush=True)

        self._is_calibrated = True

    def _find_or_create_speaker(self, embedding: np.ndarray) -> Tuple[str, float]:
        """
        Find the best matching speaker or create a new one.

        Implements speaker re-identification logic to ensure stable speaker IDs:
        1. If similarity >= 0.85 (re-identification threshold), always match to existing speaker
        2. If similarity >= standard threshold, match to existing speaker
        3. If similarity < threshold, create new speaker (with cold-start protection)

        Uses ADAPTIVE THRESHOLDS that are calibrated during cold-start to detect
        processed/compressed audio and adjust accordingly.

        Args:
            embedding: Speaker embedding vector

        Returns:
            Tuple of (speaker_id, confidence)
        """
        # Find closest existing speaker
        best_speaker = None
        best_similarity = 0.0

        for speaker_id, centroid in self._speaker_centroids.items():
            similarity = self._cosine_similarity(embedding, centroid)
            if similarity > best_similarity:
                best_similarity = similarity
                best_speaker = speaker_id

        # =====================================================================
        # ADAPTIVE THRESHOLD CALIBRATION
        # =====================================================================
        # Feed similarity scores to the calibration system during cold-start.
        # This detects processed audio and adjusts thresholds accordingly.
        # =====================================================================
        if not self._is_calibrated and best_similarity > 0:
            self._calibrate_thresholds(best_similarity)

        # Check if this is a high-confidence re-identification
        is_reidentification = best_similarity >= self._reidentification_threshold

        # Case 1: High-confidence re-identification (>= 0.85)
        # This is definitely the same speaker - always match
        if is_reidentification and best_speaker is not None:
            self._update_centroid(best_speaker, embedding)
            return best_speaker, best_similarity

        # Case 2: Normal threshold match (using EFFECTIVE threshold)
        if best_speaker is not None and best_similarity >= self._effective_similarity_threshold:
            self._update_centroid(best_speaker, embedding)
            return best_speaker, best_similarity

        # Case 3: Below threshold - potentially new speaker
        if len(self._speaker_centroids) < self.max_speakers:
            # =====================================================================
            # IMPROVED COLD-START PROTECTION (FIX for Speaker_0 issue)
            # Uses EFFECTIVE thresholds that adapt to processed audio
            # =====================================================================

            has_unstable_profiles = any(
                not stable for stable in self._speaker_profile_stable.values()
            )

            # ALWAYS-ON LOGGING for debugging speaker decisions
            is_processed = " [PROCESSED]" if self._is_processed_audio else ""
            print(f"[CoreDiarization]{is_processed} DECISION: sim={best_similarity:.3f}, "
                  f"best={best_speaker}, speakers={list(self._speaker_centroids.keys())}, "
                  f"unstable={has_unstable_profiles}, "
                  f"thresholds=(def={self._effective_definite_new_threshold:.2f}, "
                  f"new={self._effective_new_speaker_threshold:.2f}, "
                  f"min={self._effective_minimum_match_threshold:.2f})",
                  file=sys.stderr, flush=True)

            # CRITICAL FIX: If similarity is VERY low, this is definitely a different speaker
            if best_similarity < self._effective_definite_new_threshold:
                speaker_id = f"SPEAKER_{self._next_speaker_id}"
                self._next_speaker_id += 1
                self._speaker_centroids[speaker_id] = embedding.copy()
                self._speaker_counts[speaker_id] = 1
                self._speaker_embedding_history[speaker_id] = [embedding.copy()]
                self._speaker_profile_stable[speaker_id] = False
                confidence = 1.0

                print(f"[CoreDiarization] → NEW (definite): {speaker_id} "
                      f"(sim {best_similarity:.3f} < {self._effective_definite_new_threshold})",
                      file=sys.stderr, flush=True)
                return speaker_id, confidence

            elif best_similarity < self._effective_new_speaker_threshold and not has_unstable_profiles:
                # Similarity is below NEW_SPEAKER_THRESHOLD and profiles are stable
                speaker_id = f"SPEAKER_{self._next_speaker_id}"
                self._next_speaker_id += 1
                self._speaker_centroids[speaker_id] = embedding.copy()
                self._speaker_counts[speaker_id] = 1
                self._speaker_embedding_history[speaker_id] = [embedding.copy()]
                self._speaker_profile_stable[speaker_id] = False
                confidence = 1.0

                print(f"[CoreDiarization] → NEW (below threshold): {speaker_id} "
                      f"(sim {best_similarity:.3f} < {self._effective_new_speaker_threshold})",
                      file=sys.stderr, flush=True)
                return speaker_id, confidence

            elif (has_unstable_profiles and
                  best_speaker is not None and
                  best_similarity >= self._effective_minimum_match_threshold):
                # During cold-start with moderate-high similarity, be conservative
                self._update_centroid(best_speaker, embedding)

                print(f"[CoreDiarization] → COLD-START MATCH: {best_speaker} "
                      f"(sim {best_similarity:.3f} >= {self._effective_minimum_match_threshold})",
                      file=sys.stderr, flush=True)
                return best_speaker, best_similarity

            # Create new speaker - fallback case
            speaker_id = f"SPEAKER_{self._next_speaker_id}"
            self._next_speaker_id += 1
            self._speaker_centroids[speaker_id] = embedding.copy()
            self._speaker_counts[speaker_id] = 1
            self._speaker_embedding_history[speaker_id] = [embedding.copy()]
            self._speaker_profile_stable[speaker_id] = False
            confidence = 1.0

            print(f"[CoreDiarization] → NEW (fallback): {speaker_id}", file=sys.stderr, flush=True)
            return speaker_id, confidence
        else:
            # Max speakers reached, assign to closest
            speaker_id = best_speaker if best_speaker else f"SPEAKER_{self._next_speaker_id - 1}"
            if best_speaker:
                self._update_centroid(speaker_id, embedding)
            return speaker_id, best_similarity if best_similarity > 0 else 0.5

    def _update_centroid(self, speaker_id: str, embedding: np.ndarray) -> None:
        """
        Update speaker centroid with new embedding using incremental weighted averaging.

        Maintains a persistent speaker profile by:
        1. Accumulating embeddings in the history
        2. Using temporal decay weighting for centroid calculation
        3. Marking profiles as stable after enough samples
        """
        if speaker_id not in self._speaker_centroids:
            self._speaker_centroids[speaker_id] = embedding.copy()
            self._speaker_counts[speaker_id] = 1
            self._speaker_embedding_history[speaker_id] = [embedding.copy()]
            return

        # Add to embedding history
        self._speaker_embedding_history[speaker_id].append(embedding.copy())

        # Trim history if it exceeds the limit
        if len(self._speaker_embedding_history[speaker_id]) > self._max_centroid_history:
            self._speaker_embedding_history[speaker_id] = \
                self._speaker_embedding_history[speaker_id][-self._max_centroid_history:]

        # Calculate temporally-weighted centroid
        history = self._speaker_embedding_history[speaker_id]
        n = len(history)

        if n == 1:
            self._speaker_centroids[speaker_id] = embedding.copy()
        else:
            # Apply exponential decay weights (most recent = highest weight)
            weights = np.array([
                self._centroid_decay_factor ** (n - 1 - i) for i in range(n)
            ])
            weights = weights / weights.sum()  # Normalize

            # Compute weighted centroid
            weighted_centroid = np.zeros_like(embedding)
            for i, emb in enumerate(history):
                weighted_centroid += weights[i] * emb

            self._speaker_centroids[speaker_id] = weighted_centroid

        self._speaker_counts[speaker_id] = n

        # Mark profile as stable once we have enough samples
        if n >= self._min_profile_embeddings and not self._speaker_profile_stable.get(speaker_id, False):
            self._speaker_profile_stable[speaker_id] = True

    def process_audio_chunk(self, audio_data: np.ndarray) -> List[SpeakerSegment]:
        """
        Process an audio chunk and return speaker segments.

        This is the PRIMARY method for streaming diarization. It should be called
        continuously as audio data arrives, BEFORE transcription.

        Args:
            audio_data: Float32 numpy array of audio samples [-1, 1]
                       Should be mono, at the configured sample rate

        Returns:
            List of SpeakerSegment objects for the processed audio

        Raises:
            DiarizationError: If diarization fails
        """
        if not PYANNOTE_AVAILABLE or self._embedding_model is None:
            raise DiarizationError(
                "Diarization engine not properly initialized",
                "ENGINE_NOT_INITIALIZED"
            )

        # Add to buffer
        self._audio_buffer = np.concatenate([self._audio_buffer, audio_data])

        segments = []

        # Process while we have enough audio
        while len(self._audio_buffer) >= self.window_samples:
            # Extract window
            window_audio = self._audio_buffer[:self.window_samples]

            # Calculate timestamps
            start_time = self._processed_samples / self.sample_rate
            end_time = (self._processed_samples + self.window_samples) / self.sample_rate

            # Extract embedding
            embedding = self._extract_embedding(window_audio)

            if embedding is not None:
                # Find or create speaker
                speaker_id, confidence = self._find_or_create_speaker(embedding)

                # Create segment
                segment = SpeakerSegment(
                    speaker_id=speaker_id,
                    start_time=start_time,
                    end_time=end_time,
                    confidence=confidence
                )
                segments.append(segment)
                self._all_segments.append(segment)

                # Detect speaker change
                if self._current_speaker is not None and self._current_speaker != speaker_id:
                    print(f"[CoreDiarization] Speaker change: {self._current_speaker} -> {speaker_id} "
                          f"at {start_time:.2f}s", file=sys.stderr, flush=True)

                self._current_speaker = speaker_id

            # Slide window
            self._audio_buffer = self._audio_buffer[self.hop_samples:]
            self._processed_samples += self.hop_samples

        return segments

    def process_complete_audio(self, audio: np.ndarray) -> DiarizationResult:
        """
        Process a complete audio file for diarization.

        This method is for batch processing of complete audio files.

        Args:
            audio: Float32 numpy array of complete audio [-1, 1]

        Returns:
            DiarizationResult with all segments and metadata

        Raises:
            InsufficientAudioError: If audio is too short
            DiarizationError: If diarization fails
        """
        start_time = time.time()

        audio_duration = len(audio) / self.sample_rate

        if audio_duration < self.MIN_AUDIO_DURATION:
            raise InsufficientAudioError(audio_duration, self.MIN_AUDIO_DURATION)

        # Reset state for fresh processing
        self.reset()

        # Process the complete audio
        segments = self.process_audio_chunk(audio)

        # Process any remaining audio in buffer
        if len(self._audio_buffer) >= int(self.MIN_AUDIO_DURATION * self.sample_rate):
            remaining_segments = self._process_remaining_buffer()
            segments.extend(remaining_segments)

        # Merge consecutive segments from same speaker
        merged_segments = self._merge_consecutive_segments(segments)

        processing_time = time.time() - start_time

        return DiarizationResult(
            segments=merged_segments,
            num_speakers=len(self._speaker_centroids),
            speaker_ids=list(self._speaker_centroids.keys()),
            audio_duration=audio_duration,
            processing_time=processing_time
        )

    def _process_remaining_buffer(self) -> List[SpeakerSegment]:
        """Process any remaining audio in the buffer."""
        if len(self._audio_buffer) < int(self.MIN_AUDIO_DURATION * self.sample_rate):
            return []

        start_time = self._processed_samples / self.sample_rate
        end_time = (self._processed_samples + len(self._audio_buffer)) / self.sample_rate

        embedding = self._extract_embedding(self._audio_buffer)

        if embedding is not None:
            speaker_id, confidence = self._find_or_create_speaker(embedding)

            segment = SpeakerSegment(
                speaker_id=speaker_id,
                start_time=start_time,
                end_time=end_time,
                confidence=confidence
            )

            self._audio_buffer = np.array([], dtype=np.float32)
            return [segment]

        return []

    def _merge_consecutive_segments(
        self,
        segments: List[SpeakerSegment],
        max_gap: float = 0.5
    ) -> List[SpeakerSegment]:
        """Merge consecutive segments from the same speaker."""
        if not segments:
            return []

        merged = [segments[0]]

        for current in segments[1:]:
            last = merged[-1]

            # Merge if same speaker and small gap
            if (current.speaker_id == last.speaker_id and
                current.start_time - last.end_time <= max_gap):
                # Merge segments
                merged[-1] = SpeakerSegment(
                    speaker_id=last.speaker_id,
                    start_time=last.start_time,
                    end_time=current.end_time,
                    confidence=(last.confidence + current.confidence) / 2
                )
            else:
                merged.append(current)

        return merged

    def get_speaker_for_time_range(
        self,
        start_time: float,
        end_time: float
    ) -> Optional[Tuple[str, float]]:
        """
        Get the dominant speaker for a time range.

        This is useful for aligning transcription segments with speakers.

        Args:
            start_time: Start time in seconds
            end_time: End time in seconds

        Returns:
            Tuple of (speaker_id, confidence) or None if no segments overlap
        """
        # Find overlapping segments
        speaker_overlaps: Dict[str, float] = defaultdict(float)
        speaker_confidences: Dict[str, float] = {}

        for segment in self._all_segments:
            # Calculate overlap
            overlap_start = max(start_time, segment.start_time)
            overlap_end = min(end_time, segment.end_time)
            overlap = max(0, overlap_end - overlap_start)

            if overlap > 0:
                speaker_overlaps[segment.speaker_id] += overlap
                # Keep max confidence
                if segment.speaker_id not in speaker_confidences:
                    speaker_confidences[segment.speaker_id] = segment.confidence
                else:
                    speaker_confidences[segment.speaker_id] = max(
                        speaker_confidences[segment.speaker_id],
                        segment.confidence
                    )

        if not speaker_overlaps:
            return None

        # Return speaker with most overlap
        best_speaker = max(speaker_overlaps.items(), key=lambda x: x[1])[0]
        return best_speaker, speaker_confidences.get(best_speaker, 0.5)

    def get_current_speaker(self) -> Optional[str]:
        """Get the current (most recent) speaker."""
        return self._current_speaker

    def get_detected_speakers(self) -> List[str]:
        """Get list of all detected speaker IDs."""
        return list(self._speaker_centroids.keys())

    def get_speaker_statistics(self) -> Dict[str, Dict[str, Any]]:
        """Get statistics for each detected speaker."""
        stats = {}

        for speaker_id in self._speaker_centroids.keys():
            speaker_segments = [s for s in self._all_segments if s.speaker_id == speaker_id]

            if speaker_segments:
                total_duration = sum(s.duration for s in speaker_segments)
                avg_confidence = np.mean([s.confidence for s in speaker_segments])

                stats[speaker_id] = {
                    "total_duration": round(total_duration, 2),
                    "segment_count": len(speaker_segments),
                    "avg_confidence": round(float(avg_confidence), 3),
                    "first_appearance": round(min(s.start_time for s in speaker_segments), 2),
                    "last_appearance": round(max(s.end_time for s in speaker_segments), 2)
                }

        return stats

    def reset(self) -> None:
        """Reset the engine state for a new session."""
        self._speaker_centroids.clear()
        self._speaker_counts.clear()
        self._speaker_embedding_history.clear()
        self._speaker_profile_stable.clear()
        self._next_speaker_id = 0
        self._current_speaker = None
        self._audio_buffer = np.array([], dtype=np.float32)
        self._processed_samples = 0
        self._all_segments.clear()

        print("[CoreDiarization] Engine state reset", file=sys.stderr, flush=True)

    def get_speaker_profile_info(self) -> Dict[str, Dict[str, Any]]:
        """
        Get detailed information about each speaker's profile.

        Returns information about profile stability and embedding count.
        """
        profiles = {}
        for speaker_id in self._speaker_centroids.keys():
            profiles[speaker_id] = {
                "embedding_count": self._speaker_counts.get(speaker_id, 0),
                "is_stable": self._speaker_profile_stable.get(speaker_id, False)
            }
        return profiles


# ============================================================================
# Streaming Diarization Interface
# ============================================================================

class StreamingDiarizationProcessor:
    """
    High-level streaming diarization processor for integration with transcription.

    This class provides a simple interface for the audio processing pipeline:
        Audio -> process() -> Structured Segments with Speaker IDs

    The output segments can then be passed to the transcription stage.
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        min_speakers: int = 2,
        max_speakers: int = 5,
        device: Optional[str] = None
    ):
        """
        Initialize the streaming diarization processor.

        BLOCKING: Raises DiarizationError if initialization fails.

        Args:
            sample_rate: Audio sample rate (16000 Hz for Whisper compatibility)
            min_speakers: Minimum expected speakers (2-5)
            max_speakers: Maximum expected speakers (2-5)
            device: Computation device or None for auto-detect
        """
        self.engine = CoreDiarizationEngine(
            sample_rate=sample_rate,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
            window_size=2.0,  # 2 second windows for near-real-time
            hop_size=0.5,  # 0.5 second hop
            device=device
        )

        self._is_initialized = True

    def process(self, audio_chunk: np.ndarray) -> List[Dict[str, Any]]:
        """
        Process an audio chunk and return speaker segments.

        Args:
            audio_chunk: Float32 mono audio at configured sample rate

        Returns:
            List of segment dictionaries with speaker_id, start_time, end_time, confidence
        """
        if not self._is_initialized:
            raise DiarizationError("Processor not initialized", "NOT_INITIALIZED")

        segments = self.engine.process_audio_chunk(audio_chunk)
        return [s.to_dict() for s in segments]

    def get_speaker_for_transcript(
        self,
        start_time: float,
        end_time: float
    ) -> Optional[Dict[str, Any]]:
        """
        Get the speaker assignment for a transcript segment.

        Use this to assign speakers to transcription results.

        Args:
            start_time: Transcript segment start time
            end_time: Transcript segment end time

        Returns:
            Dict with speaker_id and confidence, or None
        """
        result = self.engine.get_speaker_for_time_range(start_time, end_time)
        if result:
            return {"speaker_id": result[0], "confidence": result[1]}
        return None

    def finalize(self) -> Dict[str, Any]:
        """
        Finalize the session and return statistics.

        Call this when the recording session ends.
        """
        return {
            "speakers": self.engine.get_detected_speakers(),
            "num_speakers": len(self.engine.get_detected_speakers()),
            "statistics": self.engine.get_speaker_statistics()
        }

    def reset(self) -> None:
        """Reset for a new session."""
        self.engine.reset()


# ============================================================================
# Verification Functions
# ============================================================================

def verify_diarization_available() -> Dict[str, Any]:
    """
    Verify that speaker diarization is available.

    This function should be called at startup to ensure the mandatory
    diarization requirement can be met.

    Returns:
        Dict with availability status and details
    """
    result = {
        "available": False,
        "pyannote_installed": PYANNOTE_AVAILABLE,
        "error": None,
        "message": ""
    }

    if not PYANNOTE_AVAILABLE:
        result["error"] = "PYANNOTE_NOT_AVAILABLE"
        result["message"] = f"pyannote.audio is not installed: {PYANNOTE_IMPORT_ERROR}"
        return result

    try:
        # Try to initialize the engine (will load model)
        engine = CoreDiarizationEngine(sample_rate=16000)
        result["available"] = True
        result["message"] = "Speaker diarization is available and initialized"
        result["device"] = engine.device
    except DiarizationError as e:
        result["error"] = e.error_code
        result["message"] = e.message
    except Exception as e:
        result["error"] = "UNKNOWN_ERROR"
        result["message"] = str(e)

    return result


def output_json(obj: Dict[str, Any]) -> None:
    """Output a JSON object to stdout."""
    print(json.dumps(obj, ensure_ascii=False), flush=True)


# ============================================================================
# CLI Interface
# ============================================================================

def main():
    """Command-line interface for testing the diarization engine."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Core Speaker Diarization Engine (MANDATORY preprocessing stage)"
    )

    parser.add_argument(
        "--verify",
        action="store_true",
        help="Verify diarization availability and exit"
    )

    parser.add_argument(
        "--audio",
        help="Path to audio file for batch processing"
    )

    parser.add_argument(
        "--sample-rate",
        type=int,
        default=16000,
        help="Audio sample rate (default: 16000)"
    )

    parser.add_argument(
        "--min-speakers",
        type=int,
        default=2,
        help="Minimum number of speakers (default: 2)"
    )

    parser.add_argument(
        "--max-speakers",
        type=int,
        default=5,
        help="Maximum number of speakers (default: 5)"
    )

    parser.add_argument(
        "--device",
        choices=["cuda", "cpu"],
        help="Device for inference (default: auto-detect)"
    )

    args = parser.parse_args()

    if args.verify:
        result = verify_diarization_available()
        output_json(result)
        sys.exit(0 if result["available"] else 1)

    if args.audio:
        try:
            import soundfile as sf

            # Load audio
            audio, sr = sf.read(args.audio, dtype='float32')

            # Convert to mono if stereo
            if len(audio.shape) > 1:
                audio = np.mean(audio, axis=1)

            # Resample if needed
            if sr != args.sample_rate:
                # Simple resampling (use torchaudio for better quality)
                duration = len(audio) / sr
                target_samples = int(duration * args.sample_rate)
                indices = np.linspace(0, len(audio) - 1, target_samples).astype(int)
                audio = audio[indices]

            # Initialize engine
            engine = CoreDiarizationEngine(
                sample_rate=args.sample_rate,
                min_speakers=args.min_speakers,
                max_speakers=args.max_speakers,
                device=args.device
            )

            # Process
            result = engine.process_complete_audio(audio)

            output_json(result.to_dict())

        except DiarizationError as e:
            output_json(e.to_dict())
            sys.exit(1)
        except Exception as e:
            output_json({
                "error": True,
                "error_code": "PROCESSING_ERROR",
                "message": str(e)
            })
            sys.exit(1)
    else:
        # No audio file, just verify
        result = verify_diarization_available()
        output_json(result)
        sys.exit(0 if result["available"] else 1)


if __name__ == "__main__":
    main()
