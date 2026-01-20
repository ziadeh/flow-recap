#!/usr/bin/env python3
"""
live_diarize.py - Real-time speaker diarization for live recordings

This module provides online (real-time) speaker diarization during active recordings.
It uses speaker embeddings to track and identify speakers as audio streams in.

Key Features:
- Incremental speaker detection as audio arrives
- Speaker embedding clustering for identification
- Handles overlapping speech scenarios
- Memory-efficient sliding window approach
- Compatible with stream_transcribe.py output

Usage:
    # Run alongside stream_transcribe.py for real-time speaker labels
    python live_diarize.py --sample-rate 16000

Output Format (JSON lines):
    {"type": "speaker_segment", "speaker": "Speaker_0", "start": 0.0, "end": 2.5, "confidence": 0.92}
    {"type": "speaker_change", "from_speaker": "Speaker_0", "to_speaker": "Speaker_1", "time": 2.5}
    {"type": "speaker_stats", "speakers": {"Speaker_0": {"duration": 45.2, "segments": 12}}}
"""

import argparse
import json
import sys
import os
import warnings
import numpy as np
from typing import Optional, Dict, Any, List, Tuple, Union
from collections import defaultdict
import time


# ============================================================================
# JSON Serialization Utilities - Fix for float32 serialization error
# ============================================================================

# Import comprehensive JSON serialization utilities that handle:
# - All numpy scalar types (float32, float64, int32, int64, bool_)
# - numpy.ndarray objects
# - PyTorch tensors (torch.Tensor)
# - Special float values: NaN -> null, Infinity -> large number
from json_serialization_utils import (
    to_json_serializable,
    NumpyTorchJSONEncoder,
    safe_json_dumps,
    TORCH_AVAILABLE as JSON_TORCH_AVAILABLE
)


def to_python_native(obj: Any) -> Any:
    """
    Recursively convert numpy/torch types to Python native types.

    This function is now a thin wrapper around to_json_serializable() from
    json_serialization_utils, which provides enhanced support for:
    - All numpy scalar types (float32, float64, int32, int64, bool_)
    - numpy.ndarray objects
    - PyTorch tensors (torch.Tensor)
    - Special float values: NaN -> null, Infinity -> large number
    - Nested dictionaries and lists

    Args:
        obj: Any Python object that may contain numpy/torch types

    Returns:
        Object with all values converted to JSON-serializable Python native types
    """
    return to_json_serializable(obj, warn_special_floats=False)

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

# Attempt to import required libraries
PYANNOTE_AVAILABLE = False
SPEECHBRAIN_AVAILABLE = False

try:
    from pyannote.audio import Pipeline, Model
    from pyannote.audio.pipelines import SpeakerDiarization
    import torch
    PYANNOTE_AVAILABLE = True
except ImportError:
    pass

try:
    from speechbrain.inference import SpeakerRecognition
    SPEECHBRAIN_AVAILABLE = True
except ImportError:
    pass


def output_json(obj: Dict[str, Any]) -> None:
    """
    Output a JSON object as a line to stdout.

    Uses NumpyTorchJSONEncoder to handle numpy types (float32, int64, etc.)
    and PyTorch tensors that cannot be serialized by the default JSON encoder.

    This function also handles special float values:
    - NaN values are converted to null
    - Infinity values are converted to max float value

    If serialization fails, attempts recovery by converting all values
    to Python native types. This ensures diarization pipeline continues
    even when individual segments have serialization issues.
    """
    try:
        # First try with the custom encoder that handles numpy AND torch types
        print(json.dumps(obj, ensure_ascii=False, cls=NumpyTorchJSONEncoder), flush=True)
    except TypeError as e:
        # If encoding still fails, try converting all values to native types
        try:
            converted_obj = to_json_serializable(obj, warn_special_floats=False)
            print(json.dumps(converted_obj, ensure_ascii=False), flush=True)
        except Exception as recovery_error:
            # Last resort: log error to stderr but don't crash the pipeline
            print(f"[DIARIZE DEBUG] JSON serialization error (recovery failed): {e}, {recovery_error}",
                  file=sys.stderr, flush=True)
            # Output a minimal error marker that can be parsed
            error_obj = {
                "type": "serialization_error",
                "error": str(e),
                "original_type": obj.get("type", "unknown")
            }
            print(json.dumps(error_obj, ensure_ascii=False), flush=True)


def output_status(message: str, **kwargs) -> None:
    """Output a status message."""
    output_json({"type": "status", "message": message, **kwargs})


def output_error(message: str, code: str = "ERROR") -> None:
    """Output an error message."""
    output_json({"type": "error", "message": message, "code": code})


def output_speaker_segment(speaker: str, start: float, end: float, confidence: float = None) -> None:
    """Output a speaker segment."""
    result = {
        "type": "speaker_segment",
        "speaker": speaker,
        "start": float(start),  # Ensure Python float for JSON serialization
        "end": float(end),      # Ensure Python float for JSON serialization
    }
    if confidence is not None:
        # Convert numpy float32 to Python float for JSON serialization
        result["confidence"] = float(confidence)
    output_json(result)


def output_speaker_change(from_speaker: Optional[str], to_speaker: str, time: float) -> None:
    """Output a speaker change event."""
    output_json({
        "type": "speaker_change",
        "from_speaker": from_speaker,
        "to_speaker": to_speaker,
        "time": float(time)  # Ensure Python float for JSON serialization
    })


class SpeakerEmbeddingExtractor:
    """
    Extracts speaker embeddings from audio segments for speaker identification.

    Uses either pyannote.audio or SpeechBrain for embedding extraction.
    """

    def __init__(self, device: str = "cpu"):
        self.device = device
        self.model = None
        self.backend = None

        # Try to load embedding model
        if PYANNOTE_AVAILABLE:
            self._load_pyannote_model()
        elif SPEECHBRAIN_AVAILABLE:
            self._load_speechbrain_model()
        else:
            output_error("No speaker embedding backend available", "NO_BACKEND")

    def _load_pyannote_model(self):
        """Load pyannote speaker embedding model."""
        try:
            hf_token = os.environ.get("HF_TOKEN")
            if not hf_token:
                output_error(
                    "HF_TOKEN environment variable not set. "
                    "The pyannote/embedding model requires Hugging Face authentication. "
                    "Please: 1) Create a Hugging Face account at https://huggingface.co/join, "
                    "2) Accept the model license at https://huggingface.co/pyannote/embedding, "
                    "3) Create an access token at https://huggingface.co/settings/tokens, "
                    "4) Set HF_TOKEN environment variable with your token.",
                    "AUTHENTICATION_REQUIRED"
                )
                # Try SpeechBrain as fallback
                if SPEECHBRAIN_AVAILABLE:
                    output_status("Attempting to use SpeechBrain as fallback...")
                    self._load_speechbrain_model()
                return

            # Use pyannote's speaker embedding model
            self.model = Model.from_pretrained(
                "pyannote/embedding",
                use_auth_token=hf_token
            )
            self.model = self.model.to(torch.device(self.device))
            self.model.eval()
            self.backend = "pyannote"
            output_status(f"Loaded pyannote embedding model on {self.device}")
        except Exception as e:
            error_str = str(e).lower()
            # Check for authentication-related errors
            if any(keyword in error_str for keyword in [
                'could not download', 'authenticate', 'gated', 'private',
                '401', '403', 'unauthorized', 'forbidden', 'access token',
                'hf.co/settings/tokens', 'accept the license'
            ]):
                output_error(
                    f"Failed to download pyannote/embedding model due to authentication issue: {e}. "
                    "The model is gated and requires authentication. "
                    "Please: 1) Create a Hugging Face account at https://huggingface.co/join, "
                    "2) Accept the model license at https://huggingface.co/pyannote/embedding, "
                    "3) Create an access token at https://huggingface.co/settings/tokens, "
                    "4) Set HF_TOKEN environment variable with your token.",
                    "AUTHENTICATION_REQUIRED"
                )
            else:
                output_error(f"Failed to load pyannote embedding model: {e}", "MODEL_LOAD_ERROR")

            if SPEECHBRAIN_AVAILABLE:
                output_status("Attempting to use SpeechBrain as fallback...")
                self._load_speechbrain_model()

    def _load_speechbrain_model(self):
        """Load SpeechBrain speaker embedding model."""
        try:
            self.model = SpeakerRecognition.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir="pretrained_models/spkrec-ecapa-voxceleb"
            )
            self.backend = "speechbrain"
            output_status("Loaded SpeechBrain embedding model")
        except Exception as e:
            output_error(f"Failed to load SpeechBrain model: {e}", "MODEL_LOAD_ERROR")

    def extract_embedding(self, audio: np.ndarray, sample_rate: int = 16000) -> Optional[np.ndarray]:
        """
        Extract speaker embedding from audio segment.

        Args:
            audio: Float32 numpy array of audio samples [-1, 1]
            sample_rate: Sample rate of audio

        Returns:
            Speaker embedding vector or None if extraction failed
        """
        if self.model is None:
            return None

        try:
            if self.backend == "pyannote":
                # Convert to torch tensor
                audio_tensor = torch.from_numpy(audio).float().unsqueeze(0)
                if self.device != "cpu":
                    audio_tensor = audio_tensor.to(self.device)

                with torch.no_grad():
                    embedding = self.model(audio_tensor)

                return embedding.cpu().numpy().flatten()

            elif self.backend == "speechbrain":
                # SpeechBrain expects tensor
                audio_tensor = torch.from_numpy(audio).float().unsqueeze(0)
                embedding = self.model.encode_batch(audio_tensor)
                return embedding.squeeze().cpu().numpy()

        except Exception as e:
            print(f"[DIARIZE DEBUG] Embedding extraction error: {e}", file=sys.stderr, flush=True)
            return None

        return None


class OnlineSpeakerClustering:
    """
    Online clustering of speaker embeddings for real-time speaker identification.

    Uses a centroid-based clustering approach with persistent speaker profile cache
    that maintains speaker identity across chunks. Implements:
    - Persistent speaker embedding cache for robust profiles
    - Online clustering with memory (compares against historical profiles)
    - Speaker re-identification with high-confidence matching (>0.85)
    - Incremental centroid updates with weighted averaging
    - ADAPTIVE THRESHOLDS for processed/compressed audio detection
    """

    # Re-identification threshold: if a new embedding matches an existing speaker
    # with similarity > this threshold, it's definitely the same speaker
    REIDENTIFICATION_THRESHOLD = 0.85

    # Minimum threshold for any speaker matching during cold-start (prevents false negatives)
    # INCREASED from 0.25 to 0.35 to allow more new speaker creation during cold-start
    # This is critical because at 0.25-0.30, even distinctly different voices were being merged
    # The issue is that processed audio (YouTube, system audio) can have artificially high similarity
    MINIMUM_MATCH_THRESHOLD = 0.35

    # NEW: Threshold below which a voice is DEFINITELY a different speaker
    # even during cold-start. If similarity is below this, always create new speaker
    # INCREASED from 0.20 to 0.30 because processed audio often has higher baseline similarity
    DEFINITE_NEW_SPEAKER_THRESHOLD = 0.30

    # NEW: Threshold for creating new speakers after cold-start is complete
    # If similarity is between DEFINITE_NEW_SPEAKER_THRESHOLD and NEW_SPEAKER_THRESHOLD,
    # we'll create a new speaker (more aggressive speaker separation)
    NEW_SPEAKER_THRESHOLD = 0.40

    # =========================================================================
    # ADAPTIVE THRESHOLD SYSTEM for processed/compressed audio
    # =========================================================================
    # When processing pre-recorded audio (YouTube, system audio, etc.), the baseline
    # similarity between different speakers is artificially elevated (0.6-0.8) due to:
    # - Audio compression artifacts
    # - Shared frequency characteristics from the same source
    # - Similar audio encoding/decoding pipelines
    #
    # This adaptive system detects this scenario and adjusts thresholds accordingly.
    # =========================================================================

    # Number of segments to use for calibration
    CALIBRATION_SEGMENTS = 8

    # If minimum similarity across first N segments is above this,
    # we're likely dealing with processed audio
    PROCESSED_AUDIO_MIN_SIMILARITY = 0.55

    # Adaptive threshold adjustments for processed audio
    # These are ADDED to the base thresholds when processed audio is detected
    PROCESSED_AUDIO_THRESHOLD_BOOST = 0.25

    def __init__(
        self,
        # Lower threshold = more speakers detected (more sensitive to voice differences)
        # 0.35 provides better speaker separation for typical voice differences
        # (typical same-speaker similarity: 0.8-0.95, different speakers: 0.2-0.5)
        similarity_threshold: float = 0.35,
        max_speakers: int = 10,
        min_segment_duration: float = 0.5,
        # Centroid decay factor: limits how much old embeddings influence the centroid
        # Higher = faster decay (more responsive to recent voice characteristics)
        centroid_decay_factor: float = 0.9,
        # Maximum embeddings to consider for centroid calculation
        max_centroid_history: int = 50,  # Increased from 20 for better profile accumulation
        # Minimum embeddings before a speaker profile is considered stable
        min_profile_embeddings: int = 3
    ):
        """
        Initialize online speaker clustering with persistent speaker profiles.

        Args:
            similarity_threshold: Cosine similarity threshold for speaker matching.
                                 Lower values = more speakers detected.
                                 Recommended range: 0.3-0.45 for typical multi-speaker calls
            max_speakers: Maximum number of speakers to track
            min_segment_duration: Minimum segment duration to consider
            centroid_decay_factor: Decay factor for temporal weighting of embeddings (0-1)
            max_centroid_history: Maximum number of embeddings to keep per speaker
            min_profile_embeddings: Minimum embeddings for a stable speaker profile
        """
        self.similarity_threshold = similarity_threshold
        self.max_speakers = max_speakers
        self.min_segment_duration = min_segment_duration
        self.centroid_decay_factor = centroid_decay_factor
        self.max_centroid_history = max_centroid_history
        self.min_profile_embeddings = min_profile_embeddings

        # =====================================================================
        # Persistent Speaker Profile Cache
        # These structures maintain speaker identity across all chunks
        # =====================================================================

        # Primary speaker centroids (robust mean embeddings)
        self.speaker_centroids: Dict[str, np.ndarray] = {}

        # Full embedding history per speaker for robust profile building
        # Each speaker accumulates embeddings for better re-identification
        self.speaker_embedding_history: Dict[str, List[np.ndarray]] = defaultdict(list)

        # Embedding counts per speaker (for weighted centroid update)
        self.speaker_counts: Dict[str, int] = defaultdict(int)

        # Variance tracking per speaker for confidence estimation
        self.speaker_embedding_variance: Dict[str, float] = defaultdict(float)

        # Track whether each speaker profile is considered stable
        self.speaker_profile_stable: Dict[str, bool] = defaultdict(bool)

        # Speaker statistics
        self.speaker_stats: Dict[str, Dict[str, float]] = defaultdict(
            lambda: {"duration": 0.0, "segments": 0}
        )

        # Current speaker (persists across chunks)
        self.current_speaker: Optional[str] = None
        self.current_speaker_start: float = 0.0

        # Speaker counter for new speaker IDs (NEVER reset during session)
        self._speaker_counter = 0

        # Speaker ID mapping for stability (raw ID -> stable ID)
        # Ensures Speaker_0 remains Speaker_0 throughout recording
        self._speaker_id_map: Dict[int, str] = {}

        # Track total segments processed (for enhanced early speaker detection)
        self._total_segments_processed = 0

        # Track first speaker's initial embedding for better comparison
        # This helps detect when a second speaker starts talking
        self._first_speaker_initial_embedding: Optional[np.ndarray] = None

        # =====================================================================
        # ADAPTIVE THRESHOLD CALIBRATION STATE
        # =====================================================================
        # Track similarity scores during calibration phase to detect processed audio
        self._calibration_similarities: List[float] = []
        self._is_calibrated = False
        self._is_processed_audio = False

        # Effective thresholds (may be adjusted after calibration)
        self._effective_similarity_threshold = similarity_threshold
        self._effective_definite_new_threshold = self.DEFINITE_NEW_SPEAKER_THRESHOLD
        self._effective_new_speaker_threshold = self.NEW_SPEAKER_THRESHOLD
        self._effective_minimum_match_threshold = self.MINIMUM_MATCH_THRESHOLD

        # Debug logging
        self._debug = os.environ.get("DIARIZATION_DEBUG", "0") == "1"

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Compute cosine similarity between two vectors."""
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        # Convert numpy float to Python float for JSON serialization
        return float(np.dot(a, b) / (norm_a * norm_b))

    def _find_closest_speaker(self, embedding: np.ndarray) -> Tuple[Optional[str], float, bool]:
        """
        Find the closest existing speaker to the given embedding.

        Implements speaker re-identification by comparing the new embedding against
        all existing speaker profiles (centroids). Returns the best match along with
        whether it's a high-confidence re-identification (similarity > 0.85).

        Returns:
            Tuple of (speaker_id, similarity_score, is_reidentification)
            - is_reidentification=True means similarity > REIDENTIFICATION_THRESHOLD
        """
        if not self.speaker_centroids:
            return None, 0.0, False

        best_speaker = None
        best_similarity = 0.0
        all_similarities = {}

        for speaker_id, centroid in self.speaker_centroids.items():
            similarity = self._cosine_similarity(embedding, centroid)
            all_similarities[speaker_id] = similarity
            if similarity > best_similarity:
                best_similarity = similarity
                best_speaker = speaker_id

        # Log similarity comparisons for debugging
        if self._debug and all_similarities:
            print(f"[DIARIZE DEBUG] All speaker similarities: {all_similarities}", file=sys.stderr, flush=True)

        # Check if this is a high-confidence re-identification
        is_reidentification = best_similarity >= self.REIDENTIFICATION_THRESHOLD

        if self._debug and is_reidentification:
            print(f"[DIARIZE DEBUG] HIGH-CONFIDENCE RE-IDENTIFICATION: {best_speaker} "
                  f"(similarity {best_similarity:.3f} >= {self.REIDENTIFICATION_THRESHOLD})",
                  file=sys.stderr, flush=True)

        return best_speaker, best_similarity, is_reidentification

    def _compute_profile_confidence(self, speaker_id: str) -> float:
        """
        Compute confidence in a speaker profile based on how many embeddings
        have been accumulated and their variance.

        Returns:
            Confidence score (0.0-1.0) indicating how stable/reliable the profile is
        """
        count = self.speaker_counts.get(speaker_id, 0)
        if count == 0:
            return 0.0

        # Base confidence increases with more samples (up to 10 samples = 1.0)
        sample_confidence = min(1.0, count / 10.0)

        # Adjust for variance (lower variance = higher confidence)
        variance = self.speaker_embedding_variance.get(speaker_id, 0.0)
        variance_penalty = min(0.3, variance * 0.5)  # Cap penalty at 0.3

        return max(0.0, sample_confidence - variance_penalty)

    def _calibrate_thresholds(self, similarity: float) -> None:
        """
        Calibrate thresholds during the cold-start phase to detect processed audio.

        This method tracks similarity scores during the first CALIBRATION_SEGMENTS
        segments. If the minimum similarity observed is above PROCESSED_AUDIO_MIN_SIMILARITY,
        we're likely dealing with processed/compressed audio and need to increase thresholds.

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
        if len(self._calibration_similarities) < self.CALIBRATION_SEGMENTS:
            return

        # Perform calibration
        min_similarity = min(self._calibration_similarities)
        avg_similarity = sum(self._calibration_similarities) / len(self._calibration_similarities)

        # Log calibration results
        print(f"[DIARIZE CALIBRATION] Completed with {len(self._calibration_similarities)} samples: "
              f"min_sim={min_similarity:.3f}, avg_sim={avg_similarity:.3f}, "
              f"threshold_for_processed={self.PROCESSED_AUDIO_MIN_SIMILARITY}",
              file=sys.stderr, flush=True)

        # Detect processed audio: if minimum similarity is high, audio is likely processed
        if min_similarity >= self.PROCESSED_AUDIO_MIN_SIMILARITY:
            self._is_processed_audio = True

            # Boost all thresholds for processed audio
            boost = self.PROCESSED_AUDIO_THRESHOLD_BOOST

            self._effective_similarity_threshold = self.similarity_threshold + boost
            self._effective_definite_new_threshold = self.DEFINITE_NEW_SPEAKER_THRESHOLD + boost
            self._effective_new_speaker_threshold = self.NEW_SPEAKER_THRESHOLD + boost
            self._effective_minimum_match_threshold = self.MINIMUM_MATCH_THRESHOLD + boost

            print(f"[DIARIZE CALIBRATION] ⚠️ PROCESSED AUDIO DETECTED (min_sim={min_similarity:.3f} >= {self.PROCESSED_AUDIO_MIN_SIMILARITY})",
                  file=sys.stderr, flush=True)
            print(f"[DIARIZE CALIBRATION] Adjusted thresholds: "
                  f"similarity={self._effective_similarity_threshold:.2f}, "
                  f"definite_new={self._effective_definite_new_threshold:.2f}, "
                  f"new_speaker={self._effective_new_speaker_threshold:.2f}, "
                  f"min_match={self._effective_minimum_match_threshold:.2f}",
                  file=sys.stderr, flush=True)
        else:
            print(f"[DIARIZE CALIBRATION] ✓ Live audio detected (min_sim={min_similarity:.3f} < {self.PROCESSED_AUDIO_MIN_SIMILARITY}), "
                  f"using default thresholds",
                  file=sys.stderr, flush=True)

        self._is_calibrated = True

    def _update_centroid(self, speaker_id: str, embedding: np.ndarray) -> None:
        """
        Update speaker centroid with new embedding using incremental weighted averaging.

        This method implements a robust centroid update that:
        1. Accumulates embeddings in the persistent speaker profile cache
        2. Uses temporal weighting to balance old and new embeddings
        3. Tracks embedding variance for confidence estimation
        4. Marks profiles as stable once enough samples are accumulated

        The centroid is stored persistently and updated incrementally, ensuring
        Speaker_0 remains Speaker_0 throughout the entire recording session.
        """
        # Add to embedding history (persistent across all chunks)
        self.speaker_embedding_history[speaker_id].append(embedding.copy())

        # Trim history if it exceeds the limit (keep most recent)
        if len(self.speaker_embedding_history[speaker_id]) > self.max_centroid_history:
            self.speaker_embedding_history[speaker_id] = \
                self.speaker_embedding_history[speaker_id][-self.max_centroid_history:]

        # Calculate temporally-weighted centroid
        history = self.speaker_embedding_history[speaker_id]
        n = len(history)

        if n == 1:
            self.speaker_centroids[speaker_id] = embedding.copy()
            self.speaker_embedding_variance[speaker_id] = 0.0
        else:
            # Apply exponential decay weights (most recent = highest weight)
            # weights = [decay^(n-1), decay^(n-2), ..., decay^1, decay^0]
            weights = np.array([
                self.centroid_decay_factor ** (n - 1 - i) for i in range(n)
            ])
            weights = weights / weights.sum()  # Normalize

            # Compute weighted centroid
            weighted_centroid = np.zeros_like(embedding)
            for i, emb in enumerate(history):
                weighted_centroid += weights[i] * emb

            self.speaker_centroids[speaker_id] = weighted_centroid

            # Update variance estimate (for confidence calculation)
            # Variance is the average squared distance from centroid
            if n >= 3:
                distances = [self._cosine_similarity(emb, weighted_centroid) for emb in history[-5:]]
                self.speaker_embedding_variance[speaker_id] = float(np.var(distances))

        self.speaker_counts[speaker_id] = n

        # Mark profile as stable once we have enough samples
        if n >= self.min_profile_embeddings and not self.speaker_profile_stable[speaker_id]:
            self.speaker_profile_stable[speaker_id] = True
            if self._debug:
                print(f"[DIARIZE DEBUG] Speaker profile {speaker_id} is now STABLE "
                      f"(n={n}, variance={self.speaker_embedding_variance.get(speaker_id, 0):.4f})",
                      file=sys.stderr, flush=True)

    def _create_new_speaker(self, embedding: np.ndarray) -> str:
        """
        Create a new speaker with the given embedding.

        Speaker IDs are assigned sequentially (Speaker_0, Speaker_1, etc.) and
        NEVER reset during a recording session. This ensures stable identity.
        """
        speaker_id = f"Speaker_{self._speaker_counter}"

        # Store the mapping for stability tracking
        self._speaker_id_map[self._speaker_counter] = speaker_id

        # Store the first speaker's initial embedding for better comparison
        # This helps detect when a genuinely different speaker starts talking
        if self._speaker_counter == 0:
            self._first_speaker_initial_embedding = embedding.copy()

        self._speaker_counter += 1

        # Initialize the speaker profile
        self.speaker_centroids[speaker_id] = embedding.copy()
        self.speaker_embedding_history[speaker_id] = [embedding.copy()]
        self.speaker_counts[speaker_id] = 1
        self.speaker_embedding_variance[speaker_id] = 0.0
        self.speaker_profile_stable[speaker_id] = False

        if self._debug:
            print(f"[DIARIZE DEBUG] Created new speaker: {speaker_id} (total: {self._speaker_counter})",
                  file=sys.stderr, flush=True)

        return speaker_id

    def process_segment(
        self,
        embedding: np.ndarray,
        start_time: float,
        end_time: float
    ) -> Tuple[str, float]:
        """
        Process a new audio segment and assign a speaker.

        This method implements speaker re-identification logic to ensure stable
        speaker IDs across chunks:
        1. If similarity >= 0.85 (REIDENTIFICATION_THRESHOLD), always match to existing speaker
        2. If similarity >= threshold (0.35), match to existing speaker
        3. If similarity < threshold, create new speaker (if max not reached)
        4. Always update centroid for matched speakers to improve profile

        Args:
            embedding: Speaker embedding for the segment
            start_time: Segment start time in seconds
            end_time: Segment end time in seconds

        Returns:
            Tuple of (speaker_id, confidence)
        """
        duration = end_time - start_time

        # Track total segments for enhanced early speaker detection
        self._total_segments_processed += 1

        # Find closest existing speaker with re-identification check
        closest_speaker, similarity, is_reidentification = self._find_closest_speaker(embedding)

        # =====================================================================
        # ADAPTIVE THRESHOLD CALIBRATION
        # =====================================================================
        # Feed similarity scores to the calibration system during cold-start.
        # This detects processed audio and adjusts thresholds accordingly.
        # =====================================================================
        if not self._is_calibrated and similarity > 0:
            self._calibrate_thresholds(similarity)

        # =====================================================================
        # ENHANCED EARLY SPEAKER DETECTION (FIX for Speaker_0 issue)
        # =====================================================================
        # During the first few segments, also compare against the ORIGINAL first
        # speaker's embedding (not the potentially contaminated centroid).
        # This helps detect when a genuinely different speaker starts talking.
        # =====================================================================
        first_speaker_similarity = None
        if (self._first_speaker_initial_embedding is not None and
            self._total_segments_processed <= 10 and
            self._speaker_counter == 1):  # Only one speaker so far
            first_speaker_similarity = self._cosine_similarity(
                embedding, self._first_speaker_initial_embedding
            )
            if self._debug:
                print(f"[DIARIZE DEBUG] Early detection: first_speaker_similarity={first_speaker_similarity:.3f}",
                      file=sys.stderr, flush=True)

        # Debug: Log similarity scores for all speakers
        if self._debug and self.speaker_centroids:
            print(f"[DIARIZE DEBUG] Segment {start_time:.2f}-{end_time:.2f}s: "
                  f"closest={closest_speaker}, similarity={similarity:.3f}, "
                  f"threshold={self._effective_similarity_threshold}, reident={is_reidentification}",
                  file=sys.stderr, flush=True)

        # =====================================================================
        # Speaker Assignment Logic with Re-identification
        # =====================================================================

        # Case 0 (NEW): Early detection of second speaker
        # If we're in early segments and the similarity to first speaker's ORIGINAL
        # embedding is very low, this is likely a new speaker
        # NOTE: Use effective threshold which may be boosted for processed audio
        if (first_speaker_similarity is not None and
            first_speaker_similarity < self._effective_definite_new_threshold and
            len(self.speaker_centroids) < self.max_speakers):
            speaker_id = self._create_new_speaker(embedding)
            confidence = 1.0

            if self._debug:
                print(f"[DIARIZE DEBUG] EARLY SECOND SPEAKER DETECTED: {speaker_id} "
                      f"(first_speaker_similarity {first_speaker_similarity:.3f} < {self._effective_definite_new_threshold})",
                      file=sys.stderr, flush=True)

        # Case 1: High-confidence re-identification (similarity >= 0.85)
        # This is definitely the same speaker - always match, never create new
        elif is_reidentification and closest_speaker is not None:
            speaker_id = closest_speaker
            confidence = similarity
            self._update_centroid(speaker_id, embedding)

            # ALWAYS-ON logging for high-confidence matches
            print(f"[SPEAKER DECISION] seg {start_time:.1f}-{end_time:.1f}s → RE-IDENT: {speaker_id} "
                  f"(sim {similarity:.3f} >= {self.REIDENTIFICATION_THRESHOLD})",
                  file=sys.stderr, flush=True)

        # Case 2: Normal threshold match (similarity >= standard threshold)
        # NOTE: Use effective threshold which may be boosted for processed audio
        elif closest_speaker is not None and similarity >= self._effective_similarity_threshold:
            speaker_id = closest_speaker
            confidence = similarity
            self._update_centroid(speaker_id, embedding)

            # ALWAYS-ON logging for threshold matches - this is where speakers might be wrongly merged
            print(f"[SPEAKER DECISION] seg {start_time:.1f}-{end_time:.1f}s → MATCH: {speaker_id} "
                  f"(sim {similarity:.3f} >= threshold {self._effective_similarity_threshold})",
                  file=sys.stderr, flush=True)

        # Case 3: Below threshold - potentially new speaker
        else:
            # Check if we can create a new speaker
            if len(self.speaker_centroids) < self.max_speakers:
                # =====================================================================
                # IMPROVED COLD-START PROTECTION (FIX for Speaker_0 issue)
                # =====================================================================
                # Previous logic was too aggressive - it merged all voices into Speaker_0
                # during cold-start if similarity >= 0.25. This is wrong because:
                # 1. Different speakers often have similarity 0.2-0.5
                # 2. We need to allow new speaker creation even during cold-start
                #
                # New logic (using EFFECTIVE thresholds that adapt to processed audio):
                # - If similarity < DEFINITE_NEW_SPEAKER_THRESHOLD: ALWAYS create new speaker
                # - If similarity < NEW_SPEAKER_THRESHOLD and stable: Create new speaker
                # - Only match to existing speaker during cold-start if similarity >= MINIMUM_MATCH_THRESHOLD
                # =====================================================================

                has_unstable_profiles = any(
                    not stable for stable in self.speaker_profile_stable.values()
                )

                # CRITICAL FIX: If similarity is below NEW_SPEAKER_THRESHOLD, create new speaker
                # This is more aggressive than before to ensure different speakers are separated
                #
                # ALWAYS-ON LOGGING: Log speaker decisions for debugging
                # This helps diagnose when speakers are incorrectly merged
                is_processed = " [PROCESSED]" if self._is_processed_audio else ""
                print(f"[SPEAKER DECISION]{is_processed} seg {start_time:.1f}-{end_time:.1f}s: "
                      f"sim={similarity:.3f}, closest={closest_speaker}, "
                      f"speakers={list(self.speaker_centroids.keys())}, "
                      f"unstable={has_unstable_profiles}, "
                      f"thresholds=(def={self._effective_definite_new_threshold:.2f}, "
                      f"new={self._effective_new_speaker_threshold:.2f}, "
                      f"min={self._effective_minimum_match_threshold:.2f})",
                      file=sys.stderr, flush=True)

                if similarity < self._effective_definite_new_threshold:
                    # Definitely a new speaker - very low similarity means different voice
                    speaker_id = self._create_new_speaker(embedding)
                    confidence = 1.0

                    print(f"[SPEAKER DECISION] → NEW SPEAKER (definite): {speaker_id} "
                          f"(sim {similarity:.3f} < {self._effective_definite_new_threshold})",
                          file=sys.stderr, flush=True)

                elif similarity < self._effective_new_speaker_threshold and not has_unstable_profiles:
                    # Similarity is below NEW_SPEAKER_THRESHOLD and profiles are stable
                    # Create new speaker for better separation
                    speaker_id = self._create_new_speaker(embedding)
                    confidence = 1.0

                    print(f"[SPEAKER DECISION] → NEW SPEAKER (below threshold): {speaker_id} "
                          f"(sim {similarity:.3f} < {self._effective_new_speaker_threshold})",
                          file=sys.stderr, flush=True)

                elif (has_unstable_profiles and
                      closest_speaker is not None and
                      similarity >= self._effective_minimum_match_threshold):
                    # During cold-start with moderate-high similarity, be conservative
                    speaker_id = closest_speaker
                    confidence = similarity
                    self._update_centroid(speaker_id, embedding)

                    print(f"[SPEAKER DECISION] → COLD-START MATCH: {speaker_id} "
                          f"(sim {similarity:.3f} >= {self._effective_minimum_match_threshold})",
                          file=sys.stderr, flush=True)
                else:
                    # Create new speaker - fallback case
                    speaker_id = self._create_new_speaker(embedding)
                    confidence = 1.0

                    print(f"[SPEAKER DECISION] → NEW SPEAKER (fallback): {speaker_id} "
                          f"(sim {similarity:.3f}, unstable={has_unstable_profiles})",
                          file=sys.stderr, flush=True)
            else:
                # Max speakers reached, assign to closest (must have one if max reached)
                speaker_id = closest_speaker if closest_speaker else f"Speaker_{self._speaker_counter - 1}"
                confidence = similarity if similarity > 0 else 0.5
                if closest_speaker:
                    self._update_centroid(speaker_id, embedding)

                if self._debug:
                    print(f"[DIARIZE DEBUG] Max speakers reached ({self.max_speakers}), "
                          f"assigning to closest: {speaker_id}",
                          file=sys.stderr, flush=True)

        # Update statistics
        if duration >= self.min_segment_duration:
            self.speaker_stats[speaker_id]["duration"] += duration
            self.speaker_stats[speaker_id]["segments"] += 1

        # Detect speaker change
        speaker_changed = (self.current_speaker is not None and
                         self.current_speaker != speaker_id)

        if speaker_changed:
            output_speaker_change(self.current_speaker, speaker_id, start_time)

            if self._debug:
                print(f"[DIARIZE DEBUG] SPEAKER CHANGE: {self.current_speaker} -> {speaker_id} at {start_time:.2f}s",
                      file=sys.stderr, flush=True)

        # Update current speaker (persists across all chunks)
        self.current_speaker = speaker_id

        return speaker_id, confidence

    def get_speaker_profile_info(self) -> Dict[str, Dict[str, Any]]:
        """
        Get detailed information about each speaker's profile.

        Returns information about profile stability, embedding count,
        and confidence for debugging and monitoring.
        """
        profiles = {}
        for speaker_id in self.speaker_centroids.keys():
            profiles[speaker_id] = {
                "embedding_count": self.speaker_counts.get(speaker_id, 0),
                "is_stable": self.speaker_profile_stable.get(speaker_id, False),
                "variance": float(self.speaker_embedding_variance.get(speaker_id, 0)),
                "confidence": self._compute_profile_confidence(speaker_id)
            }
        return profiles

    def get_speaker_stats(self) -> Dict[str, Dict[str, Any]]:
        """Get statistics for all detected speakers."""
        total_duration = sum(s["duration"] for s in self.speaker_stats.values())

        stats = {}
        for speaker_id, speaker_data in self.speaker_stats.items():
            # Ensure all values are Python native types for JSON serialization
            stats[speaker_id] = {
                "duration": float(speaker_data["duration"]),
                "segments": int(speaker_data["segments"]),
                "percentage": float((speaker_data["duration"] / total_duration * 100) if total_duration > 0 else 0)
            }

        return stats

    def get_num_speakers(self) -> int:
        """Get number of detected speakers."""
        return len(self.speaker_centroids)


class LiveDiarizer:
    """
    Live speaker diarization for streaming audio.

    Combines embedding extraction and online clustering to provide
    real-time speaker identification as audio streams in.

    Key features for speaker ID stability:
    - Persistent speaker profile cache across all audio chunks
    - High-confidence re-identification (similarity > 0.85) to prevent ID reset
    - Incremental centroid updates for robust speaker profiles
    - Cold-start protection to prevent over-splitting early in recording
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        segment_duration: float = 2.0,
        hop_duration: float = 0.5,
        # Lower threshold = more speakers detected (more sensitive to voice differences)
        # 0.35 provides better speaker separation for typical voice differences
        similarity_threshold: float = 0.35,
        max_speakers: int = 10,
        device: str = "cpu",
        # Centroid decay parameters for better speaker separation
        centroid_decay_factor: float = 0.9,
        # Increased from 20 to 50 for better profile accumulation and stability
        max_centroid_history: int = 50
    ):
        """
        Initialize live diarizer with persistent speaker profiles.

        Args:
            sample_rate: Audio sample rate in Hz
            segment_duration: Duration of audio segments for embedding extraction
            hop_duration: Hop size between segments (for sliding window)
            similarity_threshold: Threshold for speaker similarity matching.
                                 Lower values = more speakers detected.
                                 Recommended: 0.35 for typical multi-speaker calls
            max_speakers: Maximum number of speakers to track
            device: Device for inference ('cuda' or 'cpu')
            centroid_decay_factor: Decay factor for temporal weighting (0-1)
            max_centroid_history: Maximum embeddings to keep per speaker (50 for stability)
        """
        self.sample_rate = sample_rate
        self.segment_duration = segment_duration
        self.hop_duration = hop_duration
        self.segment_samples = int(segment_duration * sample_rate)
        self.hop_samples = int(hop_duration * sample_rate)

        # Initialize components with increased history for profile stability
        self.embedding_extractor = SpeakerEmbeddingExtractor(device=device)
        self.clustering = OnlineSpeakerClustering(
            similarity_threshold=similarity_threshold,
            max_speakers=max_speakers,
            centroid_decay_factor=centroid_decay_factor,
            max_centroid_history=max_centroid_history,
            min_profile_embeddings=3  # Mark profile stable after 3 embeddings
        )

        # Audio buffer
        self.audio_buffer = np.array([], dtype=np.float32)
        self.processed_samples = 0

        # State
        self.is_running = True
        self.total_audio_duration = 0.0

    def add_audio(self, audio: np.ndarray) -> List[Dict[str, Any]]:
        """
        Add audio and process for speaker segments.

        Args:
            audio: Float32 numpy array of audio samples

        Returns:
            List of speaker segment dictionaries
        """
        # Add to buffer
        self.audio_buffer = np.concatenate([self.audio_buffer, audio])

        segments = []

        # Process while we have enough audio
        while len(self.audio_buffer) >= self.segment_samples:
            # Extract segment
            segment_audio = self.audio_buffer[:self.segment_samples]

            # Calculate time offset
            start_time = self.processed_samples / self.sample_rate
            end_time = (self.processed_samples + self.segment_samples) / self.sample_rate

            # Extract embedding
            embedding = self.embedding_extractor.extract_embedding(
                segment_audio,
                self.sample_rate
            )

            if embedding is not None:
                # Assign speaker
                speaker_id, confidence = self.clustering.process_segment(
                    embedding,
                    start_time,
                    end_time
                )

                # Ensure all values are Python native types for JSON serialization
                segment = {
                    "speaker": speaker_id,
                    "start": float(start_time),
                    "end": float(end_time),
                    "confidence": float(confidence)
                }
                segments.append(segment)

                # Output segment
                output_speaker_segment(speaker_id, start_time, end_time, confidence)

            # Slide window
            self.audio_buffer = self.audio_buffer[self.hop_samples:]
            self.processed_samples += self.hop_samples

        self.total_audio_duration = self.processed_samples / self.sample_rate

        return segments

    def process_remaining(self) -> List[Dict[str, Any]]:
        """Process any remaining audio in buffer."""
        if len(self.audio_buffer) < self.sample_rate * 0.5:  # Less than 0.5 seconds
            return []

        start_time = self.processed_samples / self.sample_rate
        end_time = (self.processed_samples + len(self.audio_buffer)) / self.sample_rate

        embedding = self.embedding_extractor.extract_embedding(
            self.audio_buffer,
            self.sample_rate
        )

        if embedding is not None:
            speaker_id, confidence = self.clustering.process_segment(
                embedding,
                start_time,
                end_time
            )

            output_speaker_segment(speaker_id, start_time, end_time, confidence)

            # Ensure all values are Python native types for JSON serialization
            return [{
                "speaker": speaker_id,
                "start": float(start_time),
                "end": float(end_time),
                "confidence": float(confidence)
            }]

        return []

    def get_stats(self) -> Dict[str, Any]:
        """Get diarization statistics."""
        return {
            "num_speakers": self.clustering.get_num_speakers(),
            "total_duration": float(self.total_audio_duration),  # Ensure Python float for JSON serialization
            "speaker_stats": self.clustering.get_speaker_stats()
        }

    def assign_speaker_to_transcript(
        self,
        transcript_start: float,
        transcript_end: float,
        recent_segments: List[Dict[str, Any]]
    ) -> Tuple[Optional[str], float]:
        """
        Assign a speaker to a transcription segment based on timing overlap.

        Args:
            transcript_start: Transcript segment start time
            transcript_end: Transcript segment end time
            recent_segments: Recent speaker segments to match against

        Returns:
            Tuple of (speaker_id, confidence) or (None, 0.0)
        """
        if not recent_segments:
            return None, 0.0

        # Find best overlapping speaker
        speaker_overlaps: Dict[str, float] = defaultdict(float)

        for seg in recent_segments:
            overlap_start = max(transcript_start, seg["start"])
            overlap_end = min(transcript_end, seg["end"])
            overlap = max(0, overlap_end - overlap_start)

            if overlap > 0:
                speaker_overlaps[seg["speaker"]] += overlap

        if not speaker_overlaps:
            # No overlap, find nearest segment
            # IMPROVED: Check distance from transcript start/end, not just midpoint
            # This fixes the issue where a segment at 195.03s-199.97s would fail to match
            # a speaker segment at 193.00s-195.00s because the midpoint (197.5s) is too far
            # but the actual start (195.03s) is only 0.03s away from the speaker segment end

            def segment_distance(speaker_seg):
                """Calculate minimum distance between transcript and speaker segment boundaries."""
                # Distance from transcript START to speaker segment boundaries
                dist_to_start = min(
                    abs(speaker_seg["start"] - transcript_start),
                    abs(speaker_seg["end"] - transcript_start)
                )
                # Distance from transcript END to speaker segment boundaries
                dist_to_end = min(
                    abs(speaker_seg["start"] - transcript_end),
                    abs(speaker_seg["end"] - transcript_end)
                )
                # Return the minimum distance
                return min(dist_to_start, dist_to_end)

            nearest_seg = min(recent_segments, key=segment_distance)
            distance = segment_distance(nearest_seg)

            # INCREASED threshold from 1.0 to 3.0 seconds
            # Speaker segments and transcript segments can have timing differences
            # due to processing delays, so we need a larger tolerance
            if distance <= 3.0:  # Within 3 seconds
                # Reduce confidence based on distance (closer = higher confidence)
                base_confidence = float(nearest_seg.get("confidence", 0.5))
                distance_penalty = distance / 3.0  # 0.0 to 1.0
                adjusted_confidence = base_confidence * (1.0 - distance_penalty * 0.5)
                return nearest_seg["speaker"], float(adjusted_confidence)
            return None, 0.0

        # Return speaker with most overlap
        best_speaker = max(speaker_overlaps.items(), key=lambda x: x[1])

        # Calculate confidence based on overlap percentage
        transcript_duration = transcript_end - transcript_start
        confidence = best_speaker[1] / transcript_duration if transcript_duration > 0 else 0.0

        # Ensure confidence is Python float for JSON serialization
        return best_speaker[0], float(min(confidence, 1.0))


def bytes_to_float_array(audio_bytes: bytes, bit_depth: int = 16) -> np.ndarray:
    """Convert raw PCM bytes to float32 numpy array."""
    if bit_depth == 16:
        dtype = np.int16
        max_val = 32768.0
    elif bit_depth == 32:
        dtype = np.int32
        max_val = 2147483648.0
    else:
        dtype = np.int16
        max_val = 32768.0

    audio_array = np.frombuffer(audio_bytes, dtype=dtype)
    return audio_array.astype(np.float32) / max_val


def read_stdin_audio(diarizer: LiveDiarizer, bit_depth: int = 16, read_size: int = 4096) -> None:
    """Read audio from stdin and process for speaker diarization."""
    output_status("Waiting for audio data on stdin...")

    total_bytes = 0

    try:
        while diarizer.is_running:
            data = sys.stdin.buffer.read(read_size)

            if not data:
                output_status("End of audio stream")
                break

            total_bytes += len(data)

            # Convert to float array
            audio = bytes_to_float_array(data, bit_depth)

            # Process audio
            diarizer.add_audio(audio)

        # Process remaining
        diarizer.process_remaining()

        # Output final statistics
        stats = diarizer.get_stats()
        output_json({
            "type": "complete",
            "total_duration": stats["total_duration"],
            "num_speakers": stats["num_speakers"],
            "speaker_stats": stats["speaker_stats"]
        })

    except KeyboardInterrupt:
        output_status("Interrupted by user")
    except Exception as e:
        output_error(f"Error reading audio: {e}", "READ_ERROR")


def main():
    parser = argparse.ArgumentParser(
        description="Real-time speaker diarization for live recordings"
    )

    parser.add_argument(
        "--sample-rate", "-r",
        type=int,
        default=16000,
        help="Audio sample rate in Hz (default: 16000)"
    )

    parser.add_argument(
        "--bit-depth", "-b",
        type=int,
        default=16,
        choices=[16, 32],
        help="Bits per sample (default: 16)"
    )

    parser.add_argument(
        "--segment-duration",
        type=float,
        default=2.0,
        help="Duration of segments for speaker embedding (default: 2.0s)"
    )

    parser.add_argument(
        "--hop-duration",
        type=float,
        default=0.5,
        help="Hop size between segments (default: 0.5s)"
    )

    parser.add_argument(
        "--similarity-threshold",
        type=float,
        default=0.35,
        help="Speaker similarity threshold (default: 0.35). Lower values = more speakers detected. Range: 0.3-0.45 recommended."
    )

    parser.add_argument(
        "--max-speakers",
        type=int,
        default=10,
        help="Maximum number of speakers to track (default: 10)"
    )

    parser.add_argument(
        "--device", "-d",
        choices=["cuda", "cpu"],
        default=None,
        help="Device to use (default: auto-detect)"
    )

    args = parser.parse_args()

    # Check for available backends
    if not PYANNOTE_AVAILABLE and not SPEECHBRAIN_AVAILABLE:
        output_error(
            "No speaker embedding backend available. Install pyannote.audio or speechbrain.",
            "NO_BACKEND"
        )
        sys.exit(1)

    # Auto-detect device
    device = args.device
    if device is None:
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"

    # Initialize diarizer
    diarizer = LiveDiarizer(
        sample_rate=args.sample_rate,
        segment_duration=args.segment_duration,
        hop_duration=args.hop_duration,
        similarity_threshold=args.similarity_threshold,
        max_speakers=args.max_speakers,
        device=device
    )

    output_json({
        "type": "ready",
        "backend": diarizer.embedding_extractor.backend,
        "device": device,
        "sample_rate": args.sample_rate,
        "segment_duration": args.segment_duration,
        "hop_duration": args.hop_duration,
        "similarity_threshold": args.similarity_threshold,
        "max_speakers": args.max_speakers
    })

    # Start processing
    read_stdin_audio(diarizer, args.bit_depth)


if __name__ == "__main__":
    main()
