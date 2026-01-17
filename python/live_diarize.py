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
from typing import Optional, Dict, Any, List, Tuple
from collections import defaultdict
import time

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
    """Output a JSON object as a line to stdout."""
    print(json.dumps(obj, ensure_ascii=False), flush=True)


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
        "start": start,
        "end": end,
    }
    if confidence is not None:
        result["confidence"] = confidence
    output_json(result)


def output_speaker_change(from_speaker: Optional[str], to_speaker: str, time: float) -> None:
    """Output a speaker change event."""
    output_json({
        "type": "speaker_change",
        "from_speaker": from_speaker,
        "to_speaker": to_speaker,
        "time": time
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

    Uses a simple centroid-based clustering approach that can update incrementally
    as new embeddings arrive.
    """

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
        max_centroid_history: int = 20
    ):
        """
        Initialize online speaker clustering.

        Args:
            similarity_threshold: Cosine similarity threshold for speaker matching.
                                 Lower values = more speakers detected.
                                 Recommended range: 0.3-0.45 for typical multi-speaker calls
            max_speakers: Maximum number of speakers to track
            min_segment_duration: Minimum segment duration to consider
            centroid_decay_factor: Decay factor for temporal weighting of embeddings (0-1)
            max_centroid_history: Maximum number of embeddings to keep per speaker
        """
        self.similarity_threshold = similarity_threshold
        self.max_speakers = max_speakers
        self.min_segment_duration = min_segment_duration
        self.centroid_decay_factor = centroid_decay_factor
        self.max_centroid_history = max_centroid_history

        # Speaker centroids (mean embeddings)
        self.speaker_centroids: Dict[str, np.ndarray] = {}

        # Embedding history per speaker (for temporal decay)
        self.speaker_embedding_history: Dict[str, List[np.ndarray]] = defaultdict(list)

        # Embedding counts per speaker (for weighted centroid update)
        self.speaker_counts: Dict[str, int] = defaultdict(int)

        # Speaker statistics
        self.speaker_stats: Dict[str, Dict[str, float]] = defaultdict(
            lambda: {"duration": 0.0, "segments": 0}
        )

        # Current speaker
        self.current_speaker: Optional[str] = None
        self.current_speaker_start: float = 0.0

        # Speaker counter for new speaker IDs
        self._speaker_counter = 0

        # Debug logging
        self._debug = os.environ.get("DIARIZATION_DEBUG", "0") == "1"

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Compute cosine similarity between two vectors."""
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return np.dot(a, b) / (norm_a * norm_b)

    def _find_closest_speaker(self, embedding: np.ndarray) -> Tuple[Optional[str], float]:
        """
        Find the closest existing speaker to the given embedding.

        Returns:
            Tuple of (speaker_id, similarity_score) or (None, 0.0) if no match
        """
        if not self.speaker_centroids:
            return None, 0.0

        best_speaker = None
        best_similarity = 0.0

        for speaker_id, centroid in self.speaker_centroids.items():
            similarity = self._cosine_similarity(embedding, centroid)
            if similarity > best_similarity:
                best_similarity = similarity
                best_speaker = speaker_id

        return best_speaker, best_similarity

    def _update_centroid(self, speaker_id: str, embedding: np.ndarray) -> None:
        """
        Update speaker centroid with new embedding using temporal decay.

        This method uses exponential temporal weighting to give more importance
        to recent embeddings while gradually reducing the influence of older ones.
        This prevents "centroid drift" where a speaker's centroid becomes too
        generalized over time and starts absorbing other speakers.
        """
        # Add to embedding history
        self.speaker_embedding_history[speaker_id].append(embedding.copy())

        # Trim history if it exceeds the limit
        if len(self.speaker_embedding_history[speaker_id]) > self.max_centroid_history:
            self.speaker_embedding_history[speaker_id] = \
                self.speaker_embedding_history[speaker_id][-self.max_centroid_history:]

        # Calculate temporally-weighted centroid
        history = self.speaker_embedding_history[speaker_id]
        n = len(history)

        if n == 1:
            self.speaker_centroids[speaker_id] = embedding.copy()
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

        self.speaker_counts[speaker_id] = n

    def _create_new_speaker(self, embedding: np.ndarray) -> str:
        """Create a new speaker with the given embedding."""
        speaker_id = f"Speaker_{self._speaker_counter}"
        self._speaker_counter += 1
        self.speaker_centroids[speaker_id] = embedding.copy()
        self.speaker_embedding_history[speaker_id] = [embedding.copy()]
        self.speaker_counts[speaker_id] = 1

        if self._debug:
            print(f"[DIARIZE DEBUG] Created new speaker: {speaker_id} (total: {self._speaker_counter})", file=sys.stderr, flush=True)

        return speaker_id

    def process_segment(
        self,
        embedding: np.ndarray,
        start_time: float,
        end_time: float
    ) -> Tuple[str, float]:
        """
        Process a new audio segment and assign a speaker.

        Args:
            embedding: Speaker embedding for the segment
            start_time: Segment start time in seconds
            end_time: Segment end time in seconds

        Returns:
            Tuple of (speaker_id, confidence)
        """
        duration = end_time - start_time

        # Find closest existing speaker
        closest_speaker, similarity = self._find_closest_speaker(embedding)

        # Debug: Log similarity scores for all speakers
        if self._debug and self.speaker_centroids:
            all_similarities = {
                spk: self._cosine_similarity(embedding, cent)
                for spk, cent in self.speaker_centroids.items()
            }
            print(f"[DIARIZE DEBUG] Segment {start_time:.2f}-{end_time:.2f}s: "
                  f"similarities={all_similarities}, threshold={self.similarity_threshold}",
                  file=sys.stderr, flush=True)

        # Determine if this is a new speaker or existing
        is_new_speaker = closest_speaker is None or similarity < self.similarity_threshold

        if is_new_speaker:
            # New speaker detected
            if len(self.speaker_centroids) < self.max_speakers:
                speaker_id = self._create_new_speaker(embedding)
                confidence = 1.0  # New speaker, high confidence in newness

                if self._debug:
                    print(f"[DIARIZE DEBUG] NEW SPEAKER DETECTED: {speaker_id} "
                          f"(closest was {closest_speaker} with similarity {similarity:.3f} < threshold {self.similarity_threshold})",
                          file=sys.stderr, flush=True)
            else:
                # Max speakers reached, assign to closest
                speaker_id = closest_speaker
                confidence = similarity
                self._update_centroid(speaker_id, embedding)

                if self._debug:
                    print(f"[DIARIZE DEBUG] Max speakers reached ({self.max_speakers}), "
                          f"assigning to closest: {speaker_id}",
                          file=sys.stderr, flush=True)
        else:
            # Existing speaker
            speaker_id = closest_speaker
            confidence = similarity
            self._update_centroid(speaker_id, embedding)

            if self._debug:
                print(f"[DIARIZE DEBUG] Matched existing speaker: {speaker_id} "
                      f"(similarity {similarity:.3f} >= threshold {self.similarity_threshold})",
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

        self.current_speaker = speaker_id

        return speaker_id, confidence

    def get_speaker_stats(self) -> Dict[str, Dict[str, Any]]:
        """Get statistics for all detected speakers."""
        total_duration = sum(s["duration"] for s in self.speaker_stats.values())

        stats = {}
        for speaker_id, speaker_data in self.speaker_stats.items():
            stats[speaker_id] = {
                "duration": speaker_data["duration"],
                "segments": int(speaker_data["segments"]),
                "percentage": (speaker_data["duration"] / total_duration * 100) if total_duration > 0 else 0
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
        max_centroid_history: int = 20
    ):
        """
        Initialize live diarizer.

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
            max_centroid_history: Maximum embeddings to keep per speaker
        """
        self.sample_rate = sample_rate
        self.segment_duration = segment_duration
        self.hop_duration = hop_duration
        self.segment_samples = int(segment_duration * sample_rate)
        self.hop_samples = int(hop_duration * sample_rate)

        # Initialize components
        self.embedding_extractor = SpeakerEmbeddingExtractor(device=device)
        self.clustering = OnlineSpeakerClustering(
            similarity_threshold=similarity_threshold,
            max_speakers=max_speakers,
            centroid_decay_factor=centroid_decay_factor,
            max_centroid_history=max_centroid_history
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

                segment = {
                    "speaker": speaker_id,
                    "start": start_time,
                    "end": end_time,
                    "confidence": confidence
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

            return [{
                "speaker": speaker_id,
                "start": start_time,
                "end": end_time,
                "confidence": confidence
            }]

        return []

    def get_stats(self) -> Dict[str, Any]:
        """Get diarization statistics."""
        return {
            "num_speakers": self.clustering.get_num_speakers(),
            "total_duration": self.total_audio_duration,
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
            midpoint = (transcript_start + transcript_end) / 2
            nearest_seg = min(
                recent_segments,
                key=lambda s: min(abs(s["start"] - midpoint), abs(s["end"] - midpoint))
            )
            distance = min(
                abs(nearest_seg["start"] - midpoint),
                abs(nearest_seg["end"] - midpoint)
            )
            if distance <= 1.0:  # Within 1 second
                return nearest_seg["speaker"], nearest_seg.get("confidence", 0.5)
            return None, 0.0

        # Return speaker with most overlap
        best_speaker = max(speaker_overlaps.items(), key=lambda x: x[1])

        # Calculate confidence based on overlap percentage
        transcript_duration = transcript_end - transcript_start
        confidence = best_speaker[1] / transcript_duration if transcript_duration > 0 else 0.0

        return best_speaker[0], min(confidence, 1.0)


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
