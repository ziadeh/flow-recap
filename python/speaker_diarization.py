#!/usr/bin/env python3
"""
speaker_diarization.py - Comprehensive Speaker Diarization System

This module provides a complete speaker diarization solution that segments audio
recordings by identifying and separating different speakers, labeling them as
"Speaker 1", "Speaker 2", etc.

Features:
- Voice embedding extraction using pyannote.audio or SpeechBrain (ECAPA-TDNN)
- Multiple clustering algorithms (agglomerative, spectral, online centroid-based)
- Speaker change boundary detection with configurable accuracy
- Overlapping speech detection and handling
- Support for common audio formats (WAV, MP3, M4A, FLAC)
- Audio preprocessing pipeline (noise reduction, normalization, VAD)
- Quality metrics and confidence scoring

Usage:
    # Basic diarization
    python speaker_diarization.py audio.wav --output result.json

    # With specific number of speakers
    python speaker_diarization.py audio.wav --num-speakers 3

    # Full pipeline with preprocessing
    python speaker_diarization.py audio.wav --preprocess --noise-reduction

Output Format:
    {
        "segments": [
            {"start": 0.0, "end": 2.5, "speaker": "Speaker 1", "confidence": 0.92},
            {"start": 2.5, "end": 5.0, "speaker": "Speaker 2", "confidence": 0.88}
        ],
        "speakers": ["Speaker 1", "Speaker 2"],
        "num_speakers": 2,
        "quality_metrics": {...}
    }

Requirements:
    pip install pyannote.audio speechbrain torch torchaudio numpy soundfile pydub

Note:
    For pyannote.audio models, set HF_TOKEN environment variable with your
    Hugging Face access token.
"""

import argparse
import json
import os
import sys
import tempfile
import warnings
from collections import defaultdict
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
    TORCHAUDIO_AVAILABLE = True
except ImportError:
    TORCHAUDIO_AVAILABLE = False

# Import ML libraries
PYANNOTE_AVAILABLE = False
SPEECHBRAIN_AVAILABLE = False
SKLEARN_AVAILABLE = False

try:
    from pyannote.audio import Pipeline, Model
    from pyannote.audio.pipelines.utils.hook import ProgressHook
    import torch
    PYANNOTE_AVAILABLE = True
except ImportError:
    pass

try:
    from speechbrain.inference import SpeakerRecognition, VAD
    SPEECHBRAIN_AVAILABLE = True
except ImportError:
    pass

try:
    from sklearn.cluster import AgglomerativeClustering, SpectralClustering
    from sklearn.metrics import silhouette_score
    SKLEARN_AVAILABLE = True
except ImportError:
    pass


# ============================================================================
# Data Classes and Enums
# ============================================================================

class ClusteringMethod(Enum):
    """Available clustering methods for speaker identification."""
    AGGLOMERATIVE = "agglomerative"
    SPECTRAL = "spectral"
    ONLINE_CENTROID = "online_centroid"
    NEURAL = "neural"  # Uses pyannote's neural diarization


class EmbeddingBackend(Enum):
    """Available backends for speaker embedding extraction."""
    PYANNOTE = "pyannote"
    SPEECHBRAIN = "speechbrain"
    AUTO = "auto"


@dataclass
class DiarizationSegment:
    """Represents a speaker segment in the diarization output."""
    start: float  # Start time in seconds
    end: float  # End time in seconds
    speaker: str  # Speaker label (e.g., "Speaker 1")
    confidence: float = 1.0  # Confidence score (0.0-1.0)
    is_overlapping: bool = False  # True if multiple speakers detected
    overlapping_speakers: List[str] = field(default_factory=list)

    @property
    def duration(self) -> float:
        """Get segment duration in seconds."""
        return self.end - self.start

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        result = {
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "speaker": self.speaker,
            "confidence": round(self.confidence, 3),
            "duration": round(self.duration, 3)
        }
        if self.is_overlapping:
            result["is_overlapping"] = True
            result["overlapping_speakers"] = self.overlapping_speakers
        return result


@dataclass
class SpeakerStats:
    """Statistics for a single speaker."""
    speaker_id: str
    total_duration: float = 0.0
    segment_count: int = 0
    average_segment_duration: float = 0.0
    percentage: float = 0.0
    first_appearance: float = 0.0
    last_appearance: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "speaker_id": self.speaker_id,
            "total_duration": round(self.total_duration, 2),
            "segment_count": self.segment_count,
            "average_segment_duration": round(self.average_segment_duration, 2),
            "percentage": round(self.percentage, 1),
            "first_appearance": round(self.first_appearance, 2),
            "last_appearance": round(self.last_appearance, 2)
        }


@dataclass
class QualityMetrics:
    """Quality metrics for diarization output."""
    overall_confidence: float = 0.0
    speaker_clarity_score: float = 0.0  # How distinct speakers are from each other
    boundary_precision: float = 0.0  # Estimated precision of speaker boundaries
    overlap_ratio: float = 0.0  # Percentage of audio with overlapping speech
    silence_ratio: float = 0.0  # Percentage of audio that is silence
    processing_time_seconds: float = 0.0
    segments_per_minute: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "overall_confidence": round(self.overall_confidence, 3),
            "speaker_clarity_score": round(self.speaker_clarity_score, 3),
            "boundary_precision": round(self.boundary_precision, 3),
            "overlap_ratio": round(self.overlap_ratio, 3),
            "silence_ratio": round(self.silence_ratio, 3),
            "processing_time_seconds": round(self.processing_time_seconds, 2),
            "segments_per_minute": round(self.segments_per_minute, 2)
        }


@dataclass
class DiarizationResult:
    """Complete diarization result."""
    segments: List[DiarizationSegment]
    speakers: List[str]
    num_speakers: int
    speaker_stats: Dict[str, SpeakerStats]
    quality_metrics: QualityMetrics
    audio_duration: float
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "segments": [s.to_dict() for s in self.segments],
            "speakers": self.speakers,
            "num_speakers": self.num_speakers,
            "speaker_stats": {k: v.to_dict() for k, v in self.speaker_stats.items()},
            "quality_metrics": self.quality_metrics.to_dict(),
            "audio_duration": round(self.audio_duration, 2),
            "metadata": self.metadata
        }

    def format_output(self) -> str:
        """Format diarization as human-readable text."""
        lines = []
        for seg in self.segments:
            start_fmt = f"{int(seg.start // 60):02d}:{seg.start % 60:05.2f}"
            end_fmt = f"{int(seg.end // 60):02d}:{seg.end % 60:05.2f}"
            lines.append(f"[{start_fmt} - {end_fmt}] {seg.speaker}")
        return "\n".join(lines)


# ============================================================================
# Audio Preprocessing
# ============================================================================

class AudioPreprocessor:
    """
    Audio preprocessing pipeline for optimal diarization performance.

    Handles:
    - Format conversion (MP3, M4A, FLAC -> WAV)
    - Resampling to target sample rate
    - Channel conversion (stereo -> mono)
    - Noise reduction
    - Audio normalization
    - Voice Activity Detection (VAD)
    """

    SUPPORTED_FORMATS = {'.wav', '.mp3', '.m4a', '.flac', '.ogg', '.opus', '.aac'}
    TARGET_SAMPLE_RATE = 16000
    TARGET_CHANNELS = 1

    def __init__(
        self,
        target_sample_rate: int = 16000,
        apply_noise_reduction: bool = False,
        apply_normalization: bool = True,
        apply_vad: bool = False,
        vad_aggressiveness: int = 2  # 0-3, higher = more aggressive
    ):
        self.target_sample_rate = target_sample_rate
        self.apply_noise_reduction = apply_noise_reduction
        self.apply_normalization = apply_normalization
        self.apply_vad = apply_vad
        self.vad_aggressiveness = vad_aggressiveness

        # VAD model (lazy loaded)
        self._vad_model = None

    def process(
        self,
        audio_path: str,
        output_path: Optional[str] = None
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Process audio file for optimal diarization.

        Args:
            audio_path: Path to input audio file
            output_path: Optional path for processed output

        Returns:
            Tuple of (processed_audio_path, preprocessing_info)
        """
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        suffix = audio_path.suffix.lower()
        if suffix not in self.SUPPORTED_FORMATS:
            raise ValueError(f"Unsupported audio format: {suffix}. Supported: {self.SUPPORTED_FORMATS}")

        info = {
            "original_file": str(audio_path),
            "original_format": suffix,
            "preprocessing_applied": []
        }

        # Load audio
        audio, sample_rate = self._load_audio(str(audio_path))
        info["original_sample_rate"] = sample_rate
        info["original_duration"] = len(audio) / sample_rate

        # Convert to mono if needed
        if len(audio.shape) > 1 and audio.shape[1] > 1:
            audio = np.mean(audio, axis=1)
            info["preprocessing_applied"].append("stereo_to_mono")

        # Resample if needed
        if sample_rate != self.target_sample_rate:
            audio = self._resample(audio, sample_rate, self.target_sample_rate)
            sample_rate = self.target_sample_rate
            info["preprocessing_applied"].append(f"resampled_to_{self.target_sample_rate}Hz")

        # Apply noise reduction
        if self.apply_noise_reduction:
            audio = self._reduce_noise(audio, sample_rate)
            info["preprocessing_applied"].append("noise_reduction")

        # Apply normalization
        if self.apply_normalization:
            audio = self._normalize(audio)
            info["preprocessing_applied"].append("normalization")

        # Apply VAD (returns speech segments only)
        if self.apply_vad:
            audio, vad_segments = self._apply_vad(audio, sample_rate)
            info["preprocessing_applied"].append("vad")
            info["vad_segments"] = len(vad_segments)

        info["processed_sample_rate"] = sample_rate
        info["processed_duration"] = len(audio) / sample_rate

        # Save processed audio
        if output_path is None:
            output_path = tempfile.mktemp(suffix=".wav")

        self._save_audio(audio, sample_rate, output_path)
        info["processed_file"] = output_path

        return output_path, info

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
            return waveform.numpy().T, sample_rate
        else:
            raise RuntimeError("No audio loading library available. Install soundfile, pydub, or torchaudio.")

    def _save_audio(self, audio: np.ndarray, sample_rate: int, output_path: str) -> None:
        """Save audio to WAV file."""
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

    def _normalize(self, audio: np.ndarray, target_db: float = -20.0) -> np.ndarray:
        """Normalize audio to target dB level."""
        # Calculate current RMS
        rms = np.sqrt(np.mean(audio ** 2))
        if rms < 1e-10:
            return audio

        # Convert target dB to linear
        target_rms = 10 ** (target_db / 20)

        # Scale audio
        gain = target_rms / rms
        normalized = audio * gain

        # Clip to prevent clipping
        return np.clip(normalized, -1.0, 1.0)

    def _reduce_noise(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """Apply simple noise reduction using spectral gating."""
        # Simple noise reduction using a noise gate
        # More sophisticated methods would require additional libraries
        noise_threshold = np.percentile(np.abs(audio), 10)
        noise_gate = np.abs(audio) > noise_threshold * 2
        return audio * noise_gate.astype(float)

    def _apply_vad(self, audio: np.ndarray, sample_rate: int) -> Tuple[np.ndarray, List[Tuple[float, float]]]:
        """Apply Voice Activity Detection."""
        if SPEECHBRAIN_AVAILABLE and self._vad_model is None:
            try:
                self._vad_model = VAD.from_hparams(
                    source="speechbrain/vad-crdnn-libriparty",
                    savedir="pretrained_models/vad-crdnn-libriparty"
                )
            except Exception:
                pass

        if self._vad_model is not None:
            # Use SpeechBrain VAD
            audio_tensor = torch.from_numpy(audio).float().unsqueeze(0)
            boundaries = self._vad_model.get_speech_segments(audio_tensor)
            segments = [(b[0].item(), b[1].item()) for b in boundaries]
        else:
            # Fallback: simple energy-based VAD
            segments = self._energy_vad(audio, sample_rate)

        # Concatenate speech segments
        if segments:
            speech_audio = np.concatenate([
                audio[int(start * sample_rate):int(end * sample_rate)]
                for start, end in segments
            ])
            return speech_audio, segments
        return audio, [(0, len(audio) / sample_rate)]

    def _energy_vad(
        self,
        audio: np.ndarray,
        sample_rate: int,
        frame_duration: float = 0.03,
        energy_threshold: float = 0.02
    ) -> List[Tuple[float, float]]:
        """Simple energy-based VAD."""
        frame_size = int(frame_duration * sample_rate)
        num_frames = len(audio) // frame_size

        segments = []
        in_speech = False
        speech_start = 0

        for i in range(num_frames):
            frame = audio[i * frame_size:(i + 1) * frame_size]
            energy = np.sqrt(np.mean(frame ** 2))

            if energy > energy_threshold:
                if not in_speech:
                    speech_start = i * frame_duration
                    in_speech = True
            else:
                if in_speech:
                    speech_end = i * frame_duration
                    if speech_end - speech_start >= 0.1:  # Min 100ms
                        segments.append((speech_start, speech_end))
                    in_speech = False

        # Handle case where speech extends to end
        if in_speech:
            segments.append((speech_start, num_frames * frame_duration))

        return segments


# ============================================================================
# Speaker Embedding Extraction
# ============================================================================

class SpeakerEmbeddingExtractor:
    """
    Extract speaker embeddings from audio segments.

    Supports multiple backends:
    - pyannote.audio: High-quality embeddings using pyannote/embedding model
    - SpeechBrain: ECAPA-TDNN embeddings (speechbrain/spkrec-ecapa-voxceleb)
    """

    def __init__(
        self,
        backend: EmbeddingBackend = EmbeddingBackend.AUTO,
        device: str = "cpu",
        model_name: Optional[str] = None
    ):
        self.backend = backend
        self.device = device
        self.model_name = model_name
        self.model = None
        self._embedding_dim = None

        self._initialize_backend()

    def _initialize_backend(self) -> None:
        """Initialize the embedding extraction backend."""
        if self.backend == EmbeddingBackend.AUTO:
            if PYANNOTE_AVAILABLE:
                self.backend = EmbeddingBackend.PYANNOTE
            elif SPEECHBRAIN_AVAILABLE:
                self.backend = EmbeddingBackend.SPEECHBRAIN
            else:
                raise RuntimeError(
                    "No speaker embedding backend available. "
                    "Install pyannote.audio or speechbrain."
                )

        if self.backend == EmbeddingBackend.PYANNOTE:
            self._load_pyannote_model()
        elif self.backend == EmbeddingBackend.SPEECHBRAIN:
            self._load_speechbrain_model()

    def _load_pyannote_model(self) -> None:
        """Load pyannote speaker embedding model."""
        if not PYANNOTE_AVAILABLE:
            raise RuntimeError("pyannote.audio not available")

        hf_token = os.environ.get("HF_TOKEN")
        model_name = self.model_name or "pyannote/embedding"

        try:
            self.model = Model.from_pretrained(model_name, use_auth_token=hf_token)
            self.model = self.model.to(torch.device(self.device))
            self.model.eval()
            self._embedding_dim = 512  # pyannote embedding dimension
            print(f"[Diarization] Loaded pyannote embedding model on {self.device}")
        except Exception as e:
            print(f"[Diarization] Failed to load pyannote model: {e}")
            if SPEECHBRAIN_AVAILABLE:
                print("[Diarization] Falling back to SpeechBrain")
                self.backend = EmbeddingBackend.SPEECHBRAIN
                self._load_speechbrain_model()
            else:
                raise

    def _load_speechbrain_model(self) -> None:
        """Load SpeechBrain ECAPA-TDNN model."""
        if not SPEECHBRAIN_AVAILABLE:
            raise RuntimeError("SpeechBrain not available")

        try:
            self.model = SpeakerRecognition.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir="pretrained_models/spkrec-ecapa-voxceleb"
            )
            self._embedding_dim = 192  # ECAPA-TDNN embedding dimension
            print("[Diarization] Loaded SpeechBrain ECAPA-TDNN model")
        except Exception as e:
            raise RuntimeError(f"Failed to load SpeechBrain model: {e}")

    @property
    def embedding_dim(self) -> int:
        """Get embedding dimension."""
        return self._embedding_dim or 512

    def extract(
        self,
        audio: np.ndarray,
        sample_rate: int = 16000
    ) -> Optional[np.ndarray]:
        """
        Extract speaker embedding from audio segment.

        Args:
            audio: Float32 numpy array of audio samples [-1, 1]
            sample_rate: Sample rate of audio (default: 16000)

        Returns:
            Speaker embedding vector or None if extraction failed
        """
        if self.model is None:
            return None

        # Ensure minimum audio length (at least 0.5 seconds)
        min_samples = int(0.5 * sample_rate)
        if len(audio) < min_samples:
            # Pad with zeros
            audio = np.pad(audio, (0, min_samples - len(audio)))

        try:
            if self.backend == EmbeddingBackend.PYANNOTE:
                return self._extract_pyannote(audio, sample_rate)
            elif self.backend == EmbeddingBackend.SPEECHBRAIN:
                return self._extract_speechbrain(audio, sample_rate)
        except Exception as e:
            print(f"[Diarization] Embedding extraction error: {e}", file=sys.stderr)
            return None

        return None

    def _extract_pyannote(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """Extract embedding using pyannote."""
        # Ensure audio is the right shape
        if len(audio.shape) == 1:
            audio = audio[np.newaxis, :]

        audio_tensor = torch.from_numpy(audio).float()
        if self.device != "cpu":
            audio_tensor = audio_tensor.to(self.device)

        with torch.no_grad():
            embedding = self.model(audio_tensor)

        return embedding.cpu().numpy().flatten()

    def _extract_speechbrain(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """Extract embedding using SpeechBrain."""
        audio_tensor = torch.from_numpy(audio).float().unsqueeze(0)
        embedding = self.model.encode_batch(audio_tensor)
        return embedding.squeeze().cpu().numpy()

    def extract_batch(
        self,
        audio_segments: List[np.ndarray],
        sample_rate: int = 16000
    ) -> List[Optional[np.ndarray]]:
        """Extract embeddings from multiple audio segments."""
        return [self.extract(seg, sample_rate) for seg in audio_segments]


# ============================================================================
# Speaker Clustering
# ============================================================================

class SpeakerClusterer:
    """
    Cluster speaker embeddings to identify distinct speakers.

    Supports multiple clustering methods:
    - Agglomerative: Hierarchical clustering with distance threshold
    - Spectral: Spectral clustering for better handling of complex structures
    - Online Centroid: Real-time clustering using centroid matching
    """

    def __init__(
        self,
        method: ClusteringMethod = ClusteringMethod.AGGLOMERATIVE,
        num_speakers: Optional[int] = None,
        min_speakers: int = 2,
        max_speakers: int = 10,
        similarity_threshold: float = 0.4,  # Lowered from 0.55 for better multi-speaker separation
        min_cluster_size: int = 1
    ):
        self.method = method
        self.num_speakers = num_speakers
        self.min_speakers = min_speakers
        self.max_speakers = max_speakers
        self.similarity_threshold = similarity_threshold
        self.min_cluster_size = min_cluster_size

        # For online clustering
        self.speaker_centroids: Dict[int, np.ndarray] = {}
        self.speaker_counts: Dict[int, int] = defaultdict(int)
        self._next_speaker_id = 0

    def cluster(
        self,
        embeddings: np.ndarray,
        timestamps: Optional[List[Tuple[float, float]]] = None
    ) -> Tuple[np.ndarray, int, float]:
        """
        Cluster embeddings to identify speakers.

        Args:
            embeddings: Array of shape (n_segments, embedding_dim)
            timestamps: Optional list of (start, end) times for each segment

        Returns:
            Tuple of (cluster_labels, num_clusters, silhouette_score)
        """
        if len(embeddings) == 0:
            return np.array([]), 0, 0.0

        if len(embeddings) == 1:
            return np.array([0]), 1, 1.0

        # Normalize embeddings for cosine similarity
        embeddings_normalized = embeddings / (np.linalg.norm(embeddings, axis=1, keepdims=True) + 1e-10)

        if self.method == ClusteringMethod.AGGLOMERATIVE:
            labels, n_clusters = self._agglomerative_cluster(embeddings_normalized)
        elif self.method == ClusteringMethod.SPECTRAL:
            labels, n_clusters = self._spectral_cluster(embeddings_normalized)
        elif self.method == ClusteringMethod.ONLINE_CENTROID:
            labels, n_clusters = self._online_centroid_cluster(embeddings_normalized)
        else:
            # Default to agglomerative
            labels, n_clusters = self._agglomerative_cluster(embeddings_normalized)

        # Calculate silhouette score if we have multiple clusters and segments
        sil_score = 0.0
        if SKLEARN_AVAILABLE and n_clusters > 1 and len(embeddings) > n_clusters:
            try:
                sil_score = silhouette_score(embeddings_normalized, labels)
            except Exception:
                pass

        return labels, n_clusters, sil_score

    def _agglomerative_cluster(self, embeddings: np.ndarray) -> Tuple[np.ndarray, int]:
        """Perform agglomerative clustering."""
        if not SKLEARN_AVAILABLE:
            return self._online_centroid_cluster(embeddings)

        # Convert similarity threshold to distance threshold
        # Cosine distance = 1 - cosine_similarity
        distance_threshold = 1 - self.similarity_threshold

        if self.num_speakers is not None:
            # Fixed number of speakers
            clusterer = AgglomerativeClustering(
                n_clusters=self.num_speakers,
                metric='cosine',
                linkage='average'
            )
        else:
            # Auto-detect number of speakers
            clusterer = AgglomerativeClustering(
                n_clusters=None,
                distance_threshold=distance_threshold,
                metric='cosine',
                linkage='average'
            )

        labels = clusterer.fit_predict(embeddings)
        n_clusters = len(set(labels))

        # Enforce min/max speakers
        if n_clusters < self.min_speakers:
            # Force minimum number of clusters
            clusterer = AgglomerativeClustering(
                n_clusters=self.min_speakers,
                metric='cosine',
                linkage='average'
            )
            labels = clusterer.fit_predict(embeddings)
            n_clusters = self.min_speakers
        elif n_clusters > self.max_speakers:
            # Force maximum number of clusters
            clusterer = AgglomerativeClustering(
                n_clusters=self.max_speakers,
                metric='cosine',
                linkage='average'
            )
            labels = clusterer.fit_predict(embeddings)
            n_clusters = self.max_speakers

        return labels, n_clusters

    def _spectral_cluster(self, embeddings: np.ndarray) -> Tuple[np.ndarray, int]:
        """Perform spectral clustering."""
        if not SKLEARN_AVAILABLE:
            return self._online_centroid_cluster(embeddings)

        # Compute affinity matrix using cosine similarity
        affinity = np.dot(embeddings, embeddings.T)
        affinity = (affinity + 1) / 2  # Scale from [-1, 1] to [0, 1]

        # Determine number of clusters
        if self.num_speakers is not None:
            n_clusters = self.num_speakers
        else:
            # Use eigenvalue gap to estimate number of clusters
            n_clusters = min(self._estimate_num_clusters(affinity), self.max_speakers)
            n_clusters = max(n_clusters, self.min_speakers)

        clusterer = SpectralClustering(
            n_clusters=n_clusters,
            affinity='precomputed',
            random_state=42
        )
        labels = clusterer.fit_predict(affinity)

        return labels, n_clusters

    def _estimate_num_clusters(self, affinity: np.ndarray, max_k: int = 10) -> int:
        """Estimate number of clusters using eigenvalue analysis."""
        try:
            eigenvalues = np.linalg.eigvalsh(affinity)
            eigenvalues = np.sort(eigenvalues)[::-1]

            # Find largest eigenvalue gap
            gaps = np.diff(eigenvalues[:min(max_k, len(eigenvalues))])
            if len(gaps) > 0:
                return np.argmax(gaps) + 1
        except Exception:
            pass
        return 2  # Default to 2 speakers

    def _online_centroid_cluster(self, embeddings: np.ndarray) -> Tuple[np.ndarray, int]:
        """
        Online clustering using centroid matching.
        Good for real-time diarization.
        """
        labels = []

        for embedding in embeddings:
            # Find closest existing speaker
            best_speaker = None
            best_similarity = -1

            for speaker_id, centroid in self.speaker_centroids.items():
                similarity = np.dot(embedding, centroid) / (
                    np.linalg.norm(embedding) * np.linalg.norm(centroid) + 1e-10
                )
                if similarity > best_similarity:
                    best_similarity = similarity
                    best_speaker = speaker_id

            # Decide if this is a new speaker or existing
            if best_speaker is None or best_similarity < self.similarity_threshold:
                # New speaker
                if len(self.speaker_centroids) < self.max_speakers:
                    speaker_id = self._next_speaker_id
                    self._next_speaker_id += 1
                    self.speaker_centroids[speaker_id] = embedding.copy()
                    self.speaker_counts[speaker_id] = 1
                else:
                    # Max speakers reached, assign to closest
                    speaker_id = best_speaker if best_speaker is not None else 0
                    self._update_centroid(speaker_id, embedding)
            else:
                # Existing speaker
                speaker_id = best_speaker
                self._update_centroid(speaker_id, embedding)

            labels.append(speaker_id)

        return np.array(labels), len(self.speaker_centroids)

    def _update_centroid(self, speaker_id: int, embedding: np.ndarray) -> None:
        """Update speaker centroid with new embedding using running mean."""
        count = self.speaker_counts[speaker_id]
        centroid = self.speaker_centroids[speaker_id]
        self.speaker_centroids[speaker_id] = (centroid * count + embedding) / (count + 1)
        self.speaker_counts[speaker_id] = count + 1

    def reset(self) -> None:
        """Reset clustering state for new session."""
        self.speaker_centroids.clear()
        self.speaker_counts.clear()
        self._next_speaker_id = 0


# ============================================================================
# Speaker Change Detection
# ============================================================================

class SpeakerChangeDetector:
    """
    Detect speaker change boundaries in audio.

    Uses a sliding window approach to detect when speakers change,
    with configurable sensitivity for both slow and rapid transitions.
    """

    def __init__(
        self,
        embedding_extractor: SpeakerEmbeddingExtractor,
        window_size: float = 1.5,  # Window size in seconds
        hop_size: float = 0.25,  # Hop size in seconds
        change_threshold: float = 0.3,  # Similarity drop threshold for change detection
        min_segment_duration: float = 0.5  # Minimum segment duration in seconds
    ):
        self.embedding_extractor = embedding_extractor
        self.window_size = window_size
        self.hop_size = hop_size
        self.change_threshold = change_threshold
        self.min_segment_duration = min_segment_duration

    def detect_changes(
        self,
        audio: np.ndarray,
        sample_rate: int = 16000
    ) -> List[float]:
        """
        Detect speaker change points in audio.

        Args:
            audio: Audio samples as numpy array
            sample_rate: Sample rate of audio

        Returns:
            List of change point times in seconds
        """
        window_samples = int(self.window_size * sample_rate)
        hop_samples = int(self.hop_size * sample_rate)
        min_segment_samples = int(self.min_segment_duration * sample_rate)

        # Extract embeddings for each window
        embeddings = []
        timestamps = []

        for start in range(0, len(audio) - window_samples, hop_samples):
            window = audio[start:start + window_samples]
            embedding = self.embedding_extractor.extract(window, sample_rate)
            if embedding is not None:
                embeddings.append(embedding)
                timestamps.append(start / sample_rate)

        if len(embeddings) < 2:
            return []

        embeddings = np.array(embeddings)

        # Compute similarity between consecutive windows
        change_points = []
        last_change = 0

        for i in range(1, len(embeddings)):
            sim = self._cosine_similarity(embeddings[i-1], embeddings[i])

            # Check if similarity drops significantly (potential speaker change)
            if sim < (1 - self.change_threshold):
                change_time = timestamps[i]
                # Ensure minimum segment duration
                if (change_time - last_change) >= self.min_segment_duration:
                    change_points.append(change_time)
                    last_change = change_time

        return change_points

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Compute cosine similarity between two vectors."""
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return np.dot(a, b) / (norm_a * norm_b)


# ============================================================================
# Overlapping Speech Detection
# ============================================================================

class OverlapDetector:
    """
    Detect overlapping speech segments where multiple speakers talk simultaneously.

    Uses spectral analysis and embedding variance to identify overlap regions.
    """

    def __init__(
        self,
        frame_duration: float = 0.05,  # Frame size in seconds
        overlap_threshold: float = 0.6,  # Threshold for overlap detection
        min_overlap_duration: float = 0.2  # Minimum overlap duration
    ):
        self.frame_duration = frame_duration
        self.overlap_threshold = overlap_threshold
        self.min_overlap_duration = min_overlap_duration

    def detect_overlaps(
        self,
        audio: np.ndarray,
        sample_rate: int = 16000,
        speaker_segments: Optional[List[DiarizationSegment]] = None
    ) -> List[Tuple[float, float, List[str]]]:
        """
        Detect overlapping speech regions.

        Args:
            audio: Audio samples
            sample_rate: Sample rate
            speaker_segments: Optional pre-computed speaker segments

        Returns:
            List of (start, end, overlapping_speakers) tuples
        """
        overlaps = []

        # If we have speaker segments, check for temporal overlaps
        if speaker_segments:
            overlaps = self._detect_from_segments(speaker_segments)

        # Additionally, use spectral analysis for unsegmented detection
        spectral_overlaps = self._detect_spectral_overlaps(audio, sample_rate)

        # Merge both detection methods
        return self._merge_overlaps(overlaps + spectral_overlaps)

    def _detect_from_segments(
        self,
        segments: List[DiarizationSegment]
    ) -> List[Tuple[float, float, List[str]]]:
        """Detect overlaps from pre-computed segments."""
        overlaps = []

        # Sort segments by start time
        sorted_segments = sorted(segments, key=lambda s: s.start)

        for i, seg1 in enumerate(sorted_segments):
            for seg2 in sorted_segments[i+1:]:
                # Check if segments overlap temporally
                if seg2.start >= seg1.end:
                    break

                if seg1.speaker != seg2.speaker:
                    overlap_start = max(seg1.start, seg2.start)
                    overlap_end = min(seg1.end, seg2.end)

                    if overlap_end - overlap_start >= self.min_overlap_duration:
                        overlaps.append((
                            overlap_start,
                            overlap_end,
                            [seg1.speaker, seg2.speaker]
                        ))

        return overlaps

    def _detect_spectral_overlaps(
        self,
        audio: np.ndarray,
        sample_rate: int
    ) -> List[Tuple[float, float, List[str]]]:
        """
        Detect overlaps using spectral analysis.

        Overlapping speech typically shows:
        - Higher spectral complexity
        - Multiple pitch frequencies
        - Higher energy variance
        """
        frame_samples = int(self.frame_duration * sample_rate)
        overlaps = []

        # Simple energy-based overlap detection
        # Real implementation would use more sophisticated methods
        in_overlap = False
        overlap_start = 0

        for i in range(0, len(audio) - frame_samples, frame_samples):
            frame = audio[i:i + frame_samples]

            # Compute spectral flatness (low for tonal, high for noise-like/complex)
            spectrum = np.abs(np.fft.fft(frame)[:len(frame)//2])
            if np.mean(spectrum) > 0:
                flatness = np.exp(np.mean(np.log(spectrum + 1e-10))) / np.mean(spectrum)
            else:
                flatness = 0

            # High spectral flatness with high energy might indicate overlap
            energy = np.sqrt(np.mean(frame ** 2))
            is_potential_overlap = flatness > self.overlap_threshold and energy > 0.02

            if is_potential_overlap and not in_overlap:
                overlap_start = i / sample_rate
                in_overlap = True
            elif not is_potential_overlap and in_overlap:
                overlap_end = i / sample_rate
                if overlap_end - overlap_start >= self.min_overlap_duration:
                    overlaps.append((overlap_start, overlap_end, ["Unknown", "Unknown"]))
                in_overlap = False

        return overlaps

    def _merge_overlaps(
        self,
        overlaps: List[Tuple[float, float, List[str]]]
    ) -> List[Tuple[float, float, List[str]]]:
        """Merge overlapping overlap regions."""
        if not overlaps:
            return []

        # Sort by start time
        sorted_overlaps = sorted(overlaps, key=lambda x: x[0])
        merged = [sorted_overlaps[0]]

        for current in sorted_overlaps[1:]:
            last = merged[-1]
            if current[0] <= last[1]:
                # Merge overlapping regions
                speakers = list(set(last[2] + current[2]))
                merged[-1] = (last[0], max(last[1], current[1]), speakers)
            else:
                merged.append(current)

        return merged


# ============================================================================
# Main Speaker Diarization System
# ============================================================================

class SpeakerDiarizationSystem:
    """
    Complete speaker diarization system that orchestrates all components.

    Provides both batch processing for complete audio files and
    streaming interface for real-time diarization.
    """

    def __init__(
        self,
        embedding_backend: EmbeddingBackend = EmbeddingBackend.AUTO,
        clustering_method: ClusteringMethod = ClusteringMethod.AGGLOMERATIVE,
        device: str = "cpu",
        num_speakers: Optional[int] = None,
        min_speakers: int = 2,
        max_speakers: int = 10,
        similarity_threshold: float = 0.4,  # Lowered from 0.55 for better multi-speaker separation
        segment_duration: float = 2.0,
        hop_duration: float = 0.5,
        detect_overlaps: bool = True,
        use_neural_pipeline: bool = False  # Use pyannote's full neural pipeline
    ):
        """
        Initialize the speaker diarization system.

        Args:
            embedding_backend: Backend for speaker embeddings
            clustering_method: Clustering algorithm to use
            device: Device for inference ('cuda' or 'cpu')
            num_speakers: Fixed number of speakers (None for auto-detection)
            min_speakers: Minimum number of speakers to detect
            max_speakers: Maximum number of speakers to detect
            similarity_threshold: Threshold for speaker similarity matching
            segment_duration: Duration of audio segments for embedding extraction
            hop_duration: Hop size between segments
            detect_overlaps: Whether to detect overlapping speech
            use_neural_pipeline: Use pyannote's full neural diarization pipeline
        """
        self.device = device
        self.num_speakers = num_speakers
        self.min_speakers = min_speakers
        self.max_speakers = max_speakers
        self.segment_duration = segment_duration
        self.hop_duration = hop_duration
        self.detect_overlaps_flag = detect_overlaps
        self.use_neural_pipeline = use_neural_pipeline

        # Auto-detect device
        if device == "auto":
            import torch
            self.device = "cuda" if torch.cuda.is_available() else "cpu"

        # Initialize components
        self.preprocessor = AudioPreprocessor()

        if use_neural_pipeline and PYANNOTE_AVAILABLE:
            self._pipeline = None  # Lazy load
        else:
            self.embedding_extractor = SpeakerEmbeddingExtractor(
                backend=embedding_backend,
                device=self.device
            )
            self.clusterer = SpeakerClusterer(
                method=clustering_method,
                num_speakers=num_speakers,
                min_speakers=min_speakers,
                max_speakers=max_speakers,
                similarity_threshold=similarity_threshold
            )
            self.change_detector = SpeakerChangeDetector(
                self.embedding_extractor,
                window_size=segment_duration,
                hop_size=hop_duration
            )

        if detect_overlaps:
            self.overlap_detector = OverlapDetector()

    def _load_neural_pipeline(self) -> None:
        """Lazy load pyannote neural diarization pipeline."""
        if self._pipeline is not None:
            return

        if not PYANNOTE_AVAILABLE:
            raise RuntimeError("pyannote.audio not available for neural pipeline")

        hf_token = os.environ.get("HF_TOKEN")
        if not hf_token:
            print("[Diarization] Warning: HF_TOKEN not set, pyannote pipeline may fail")

        self._pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token
        )
        self._pipeline = self._pipeline.to(torch.device(self.device))
        print(f"[Diarization] Loaded pyannote neural pipeline on {self.device}")

    def diarize(
        self,
        audio_path: str,
        preprocess: bool = True,
        return_embeddings: bool = False,
        progress_callback: Optional[callable] = None
    ) -> DiarizationResult:
        """
        Perform speaker diarization on an audio file.

        Args:
            audio_path: Path to audio file
            preprocess: Whether to apply preprocessing
            return_embeddings: Whether to return speaker embeddings in result
            progress_callback: Optional callback for progress updates

        Returns:
            DiarizationResult with segments, speakers, and quality metrics
        """
        import time
        start_time = time.time()

        # Validate input
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        # Preprocess audio
        if preprocess:
            if progress_callback:
                progress_callback({"phase": "preprocessing", "progress": 0.1})
            processed_path, preprocess_info = self.preprocessor.process(str(audio_path))
        else:
            processed_path = str(audio_path)
            preprocess_info = {}

        # Load audio
        audio, sample_rate = self.preprocessor._load_audio(processed_path)
        if len(audio.shape) > 1:
            audio = np.mean(audio, axis=1)
        audio_duration = len(audio) / sample_rate

        if progress_callback:
            progress_callback({"phase": "diarization", "progress": 0.2})

        # Use neural pipeline if configured
        if self.use_neural_pipeline and PYANNOTE_AVAILABLE:
            segments = self._diarize_neural(processed_path, audio_duration, progress_callback)
        else:
            segments = self._diarize_embedding_based(
                audio, sample_rate, audio_duration, progress_callback
            )

        if progress_callback:
            progress_callback({"phase": "post_processing", "progress": 0.8})

        # Detect overlapping speech
        overlaps = []
        if self.detect_overlaps_flag and segments:
            overlaps = self.overlap_detector.detect_overlaps(
                audio, sample_rate, segments
            )
            # Mark overlapping segments
            for start, end, speakers in overlaps:
                for seg in segments:
                    if seg.start < end and seg.end > start:
                        seg.is_overlapping = True
                        seg.overlapping_speakers = speakers

        # Compute speaker statistics
        speakers = sorted(list(set(s.speaker for s in segments)))
        speaker_stats = self._compute_speaker_stats(segments, audio_duration)

        # Compute quality metrics
        processing_time = time.time() - start_time
        quality_metrics = self._compute_quality_metrics(
            segments, speakers, audio_duration, processing_time, overlaps
        )

        # Build result
        result = DiarizationResult(
            segments=segments,
            speakers=speakers,
            num_speakers=len(speakers),
            speaker_stats=speaker_stats,
            quality_metrics=quality_metrics,
            audio_duration=audio_duration,
            metadata={
                "audio_file": str(audio_path),
                "preprocessed": preprocess,
                "preprocessing_info": preprocess_info,
                "device": self.device,
                "use_neural_pipeline": self.use_neural_pipeline
            }
        )

        if progress_callback:
            progress_callback({"phase": "complete", "progress": 1.0})

        return result

    def _diarize_neural(
        self,
        audio_path: str,
        audio_duration: float,
        progress_callback: Optional[callable]
    ) -> List[DiarizationSegment]:
        """Diarize using pyannote neural pipeline."""
        self._load_neural_pipeline()

        # Prepare pipeline parameters
        params = {}
        if self.num_speakers is not None:
            params["num_speakers"] = self.num_speakers
        else:
            params["min_speakers"] = self.min_speakers
            params["max_speakers"] = self.max_speakers

        # Run pipeline
        if progress_callback:
            with ProgressHook() as hook:
                diarization = self._pipeline(audio_path, hook=hook, **params)
        else:
            diarization = self._pipeline(audio_path, **params)

        # Convert to segments
        segments = []
        speaker_map = {}
        speaker_counter = 0

        for turn, _, speaker in diarization.itertracks(yield_label=True):
            if speaker not in speaker_map:
                speaker_map[speaker] = f"Speaker {speaker_counter + 1}"
                speaker_counter += 1

            segments.append(DiarizationSegment(
                start=turn.start,
                end=turn.end,
                speaker=speaker_map[speaker],
                confidence=0.9  # Neural pipeline doesn't provide per-segment confidence
            ))

        return segments

    def _diarize_embedding_based(
        self,
        audio: np.ndarray,
        sample_rate: int,
        audio_duration: float,
        progress_callback: Optional[callable]
    ) -> List[DiarizationSegment]:
        """Diarize using embedding extraction and clustering."""
        segment_samples = int(self.segment_duration * sample_rate)
        hop_samples = int(self.hop_duration * sample_rate)

        # Extract embeddings for each segment
        embeddings = []
        timestamps = []

        total_segments = (len(audio) - segment_samples) // hop_samples + 1
        for i, start in enumerate(range(0, len(audio) - segment_samples + 1, hop_samples)):
            segment_audio = audio[start:start + segment_samples]
            embedding = self.embedding_extractor.extract(segment_audio, sample_rate)

            if embedding is not None:
                embeddings.append(embedding)
                timestamps.append((start / sample_rate, (start + segment_samples) / sample_rate))

            if progress_callback and i % 10 == 0:
                progress = 0.2 + 0.4 * (i / total_segments)
                progress_callback({"phase": "embedding_extraction", "progress": progress})

        if not embeddings:
            return []

        embeddings = np.array(embeddings)

        if progress_callback:
            progress_callback({"phase": "clustering", "progress": 0.7})

        # Cluster embeddings
        labels, num_clusters, silhouette = self.clusterer.cluster(embeddings, timestamps)

        # Create segments
        segments = []
        for i, (label, (start, end)) in enumerate(zip(labels, timestamps)):
            # Compute confidence based on distance to cluster centroid
            confidence = self._compute_segment_confidence(
                embeddings[i], label, embeddings, labels
            )

            segments.append(DiarizationSegment(
                start=start,
                end=end,
                speaker=f"Speaker {label + 1}",
                confidence=confidence
            ))

        # Merge consecutive segments from same speaker
        segments = self._merge_consecutive_segments(segments)

        return segments

    def _compute_segment_confidence(
        self,
        embedding: np.ndarray,
        label: int,
        all_embeddings: np.ndarray,
        all_labels: np.ndarray
    ) -> float:
        """Compute confidence score for a segment assignment."""
        # Get all embeddings for the same speaker
        same_speaker_mask = all_labels == label
        same_speaker_embeddings = all_embeddings[same_speaker_mask]

        if len(same_speaker_embeddings) < 2:
            return 0.8  # Default confidence

        # Compute centroid
        centroid = np.mean(same_speaker_embeddings, axis=0)

        # Compute similarity to centroid
        similarity = np.dot(embedding, centroid) / (
            np.linalg.norm(embedding) * np.linalg.norm(centroid) + 1e-10
        )

        # Convert to confidence score [0, 1]
        return float(np.clip((similarity + 1) / 2, 0, 1))

    def _merge_consecutive_segments(
        self,
        segments: List[DiarizationSegment],
        max_gap: float = 0.5
    ) -> List[DiarizationSegment]:
        """Merge consecutive segments from the same speaker."""
        if not segments:
            return []

        merged = [segments[0]]

        for current in segments[1:]:
            last = merged[-1]

            # Merge if same speaker and small gap
            if (current.speaker == last.speaker and
                current.start - last.end <= max_gap):
                # Merge segments
                merged[-1] = DiarizationSegment(
                    start=last.start,
                    end=current.end,
                    speaker=last.speaker,
                    confidence=(last.confidence + current.confidence) / 2,
                    is_overlapping=last.is_overlapping or current.is_overlapping
                )
            else:
                merged.append(current)

        return merged

    def _compute_speaker_stats(
        self,
        segments: List[DiarizationSegment],
        audio_duration: float
    ) -> Dict[str, SpeakerStats]:
        """Compute statistics for each speaker."""
        stats = {}

        for seg in segments:
            if seg.speaker not in stats:
                stats[seg.speaker] = SpeakerStats(
                    speaker_id=seg.speaker,
                    first_appearance=seg.start
                )

            s = stats[seg.speaker]
            s.total_duration += seg.duration
            s.segment_count += 1
            s.last_appearance = max(s.last_appearance, seg.end)

        # Compute derived statistics
        total_speech = sum(s.total_duration for s in stats.values())
        for s in stats.values():
            if s.segment_count > 0:
                s.average_segment_duration = s.total_duration / s.segment_count
            if total_speech > 0:
                s.percentage = (s.total_duration / total_speech) * 100

        return stats

    def _compute_quality_metrics(
        self,
        segments: List[DiarizationSegment],
        speakers: List[str],
        audio_duration: float,
        processing_time: float,
        overlaps: List[Tuple[float, float, List[str]]]
    ) -> QualityMetrics:
        """Compute quality metrics for the diarization."""
        metrics = QualityMetrics()

        if not segments:
            return metrics

        # Overall confidence
        confidences = [s.confidence for s in segments]
        metrics.overall_confidence = np.mean(confidences) if confidences else 0.0

        # Speaker clarity (based on confidence variance - lower variance = clearer)
        if len(confidences) > 1:
            variance = np.var(confidences)
            metrics.speaker_clarity_score = 1 - min(variance * 4, 1)  # Scale to [0, 1]
        else:
            metrics.speaker_clarity_score = 1.0

        # Boundary precision (estimated based on segment duration consistency)
        durations = [s.duration for s in segments]
        if len(durations) > 1:
            cv = np.std(durations) / (np.mean(durations) + 1e-10)  # Coefficient of variation
            metrics.boundary_precision = 1 - min(cv / 2, 1)  # Lower CV = better precision
        else:
            metrics.boundary_precision = 1.0

        # Overlap ratio
        total_overlap = sum(end - start for start, end, _ in overlaps)
        metrics.overlap_ratio = total_overlap / audio_duration if audio_duration > 0 else 0

        # Silence ratio (1 - speech ratio)
        total_speech = sum(s.duration for s in segments)
        metrics.silence_ratio = 1 - (total_speech / audio_duration) if audio_duration > 0 else 0

        # Processing metrics
        metrics.processing_time_seconds = processing_time
        if audio_duration > 0:
            metrics.segments_per_minute = len(segments) / (audio_duration / 60)

        return metrics


# ============================================================================
# Streaming Diarization Interface
# ============================================================================

class StreamingDiarizer:
    """
    Real-time streaming speaker diarization.

    Processes audio chunks as they arrive for live diarization.
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        segment_duration: float = 2.0,
        hop_duration: float = 0.5,
        similarity_threshold: float = 0.4,  # Lowered from 0.55 for better multi-speaker separation
        max_speakers: int = 10,
        device: str = "cpu"
    ):
        self.sample_rate = sample_rate
        self.segment_duration = segment_duration
        self.hop_duration = hop_duration
        self.segment_samples = int(segment_duration * sample_rate)
        self.hop_samples = int(hop_duration * sample_rate)

        # Initialize components
        self.embedding_extractor = SpeakerEmbeddingExtractor(device=device)
        self.clusterer = SpeakerClusterer(
            method=ClusteringMethod.ONLINE_CENTROID,
            similarity_threshold=similarity_threshold,
            max_speakers=max_speakers
        )

        # Audio buffer
        self.audio_buffer = np.array([], dtype=np.float32)
        self.processed_samples = 0
        self.segments: List[DiarizationSegment] = []
        self.current_speaker: Optional[str] = None

    def add_audio(self, audio_chunk: np.ndarray) -> List[DiarizationSegment]:
        """
        Add audio chunk and return any new speaker segments.

        Args:
            audio_chunk: Float32 numpy array of audio samples

        Returns:
            List of new DiarizationSegment objects
        """
        # Add to buffer
        self.audio_buffer = np.concatenate([self.audio_buffer, audio_chunk])

        new_segments = []

        # Process while we have enough audio
        while len(self.audio_buffer) >= self.segment_samples:
            segment_audio = self.audio_buffer[:self.segment_samples]

            # Calculate timestamps
            start_time = self.processed_samples / self.sample_rate
            end_time = (self.processed_samples + self.segment_samples) / self.sample_rate

            # Extract embedding
            embedding = self.embedding_extractor.extract(segment_audio, self.sample_rate)

            if embedding is not None:
                # Cluster to get speaker
                labels, _, _ = self.clusterer.cluster(embedding.reshape(1, -1))
                speaker_id = labels[0]
                speaker_label = f"Speaker {speaker_id + 1}"

                # Compute confidence
                confidence = self._compute_confidence(embedding, speaker_id)

                segment = DiarizationSegment(
                    start=start_time,
                    end=end_time,
                    speaker=speaker_label,
                    confidence=confidence
                )

                # Detect speaker change
                if self.current_speaker != speaker_label:
                    self.current_speaker = speaker_label

                new_segments.append(segment)
                self.segments.append(segment)

            # Slide window
            self.audio_buffer = self.audio_buffer[self.hop_samples:]
            self.processed_samples += self.hop_samples

        return new_segments

    def _compute_confidence(self, embedding: np.ndarray, speaker_id: int) -> float:
        """Compute confidence for speaker assignment."""
        if speaker_id not in self.clusterer.speaker_centroids:
            return 0.8

        centroid = self.clusterer.speaker_centroids[speaker_id]
        similarity = np.dot(embedding, centroid) / (
            np.linalg.norm(embedding) * np.linalg.norm(centroid) + 1e-10
        )
        return float(np.clip((similarity + 1) / 2, 0, 1))

    def finalize(self) -> DiarizationResult:
        """
        Finalize streaming session and return complete result.
        """
        # Process remaining audio
        if len(self.audio_buffer) >= self.sample_rate * 0.5:  # At least 0.5 seconds
            start_time = self.processed_samples / self.sample_rate
            end_time = (self.processed_samples + len(self.audio_buffer)) / self.sample_rate

            embedding = self.embedding_extractor.extract(self.audio_buffer, self.sample_rate)
            if embedding is not None:
                labels, _, _ = self.clusterer.cluster(embedding.reshape(1, -1))
                speaker_label = f"Speaker {labels[0] + 1}"

                self.segments.append(DiarizationSegment(
                    start=start_time,
                    end=end_time,
                    speaker=speaker_label,
                    confidence=0.7
                ))

        # Compute final statistics
        audio_duration = (self.processed_samples + len(self.audio_buffer)) / self.sample_rate
        speakers = sorted(list(set(s.speaker for s in self.segments)))

        return DiarizationResult(
            segments=self.segments,
            speakers=speakers,
            num_speakers=len(speakers),
            speaker_stats=self._compute_stats(audio_duration),
            quality_metrics=QualityMetrics(),
            audio_duration=audio_duration
        )

    def _compute_stats(self, audio_duration: float) -> Dict[str, SpeakerStats]:
        """Compute speaker statistics."""
        stats = {}
        for seg in self.segments:
            if seg.speaker not in stats:
                stats[seg.speaker] = SpeakerStats(speaker_id=seg.speaker)
            stats[seg.speaker].total_duration += seg.duration
            stats[seg.speaker].segment_count += 1

        total = sum(s.total_duration for s in stats.values())
        for s in stats.values():
            s.percentage = (s.total_duration / total * 100) if total > 0 else 0
            if s.segment_count > 0:
                s.average_segment_duration = s.total_duration / s.segment_count

        return stats

    def reset(self) -> None:
        """Reset streaming state for new session."""
        self.audio_buffer = np.array([], dtype=np.float32)
        self.processed_samples = 0
        self.segments = []
        self.current_speaker = None
        self.clusterer.reset()


# ============================================================================
# Output Formatting
# ============================================================================

def format_as_rttm(result: DiarizationResult, file_id: str = "audio") -> str:
    """
    Format diarization result as RTTM (Rich Transcription Time Marked).

    RTTM format: SPEAKER file 1 start duration <NA> <NA> speaker <NA> <NA>
    """
    lines = []
    for seg in result.segments:
        lines.append(
            f"SPEAKER {file_id} 1 {seg.start:.3f} {seg.duration:.3f} "
            f"<NA> <NA> {seg.speaker.replace(' ', '_')} <NA> <NA>"
        )
    return "\n".join(lines)


def format_as_srt(result: DiarizationResult) -> str:
    """Format diarization result as SRT-like format."""
    lines = []
    for i, seg in enumerate(result.segments, 1):
        start_fmt = _format_timestamp(seg.start)
        end_fmt = _format_timestamp(seg.end)
        lines.append(f"{i}")
        lines.append(f"{start_fmt} --> {end_fmt}")
        lines.append(f"[{seg.speaker}]")
        lines.append("")
    return "\n".join(lines)


def _format_timestamp(seconds: float) -> str:
    """Format seconds as HH:MM:SS,mmm."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds - int(seconds)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


# ============================================================================
# CLI Interface
# ============================================================================

def main():
    """Command-line interface for speaker diarization."""
    parser = argparse.ArgumentParser(
        description="Speaker Diarization System - Identify and segment speakers in audio",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic diarization
  python speaker_diarization.py audio.wav

  # Specify number of speakers
  python speaker_diarization.py audio.wav --num-speakers 3

  # Use neural pipeline (requires HF_TOKEN)
  python speaker_diarization.py audio.wav --neural-pipeline

  # Full preprocessing with noise reduction
  python speaker_diarization.py audio.wav --preprocess --noise-reduction

  # Output formats
  python speaker_diarization.py audio.wav --format json --output result.json
  python speaker_diarization.py audio.wav --format rttm --output result.rttm
  python speaker_diarization.py audio.wav --format text

Environment:
  HF_TOKEN: Hugging Face access token for pyannote models
        """
    )

    parser.add_argument("audio_file", help="Path to audio file")

    # Speaker configuration
    parser.add_argument("--num-speakers", "-n", type=int,
                        help="Exact number of speakers (auto-detect if not specified)")
    parser.add_argument("--min-speakers", type=int, default=2,
                        help="Minimum number of speakers (default: 2 for multi-speaker scenarios)")
    parser.add_argument("--max-speakers", type=int, default=10,
                        help="Maximum number of speakers (default: 10)")
    parser.add_argument("--similarity-threshold", type=float, default=0.4,
                        help="Speaker similarity threshold (default: 0.4, lower = more speakers detected)")

    # Processing options
    parser.add_argument("--preprocess", action="store_true",
                        help="Apply audio preprocessing")
    parser.add_argument("--noise-reduction", action="store_true",
                        help="Apply noise reduction (requires --preprocess)")
    parser.add_argument("--neural-pipeline", action="store_true",
                        help="Use pyannote neural diarization pipeline")
    parser.add_argument("--no-overlap-detection", action="store_true",
                        help="Disable overlapping speech detection")

    # Clustering options
    parser.add_argument("--clustering", choices=["agglomerative", "spectral", "online"],
                        default="agglomerative",
                        help="Clustering method (default: agglomerative)")

    # Output options
    parser.add_argument("--output", "-o", help="Output file path")
    parser.add_argument("--format", "-f", choices=["json", "text", "rttm", "srt"],
                        default="json", help="Output format (default: json)")

    # Hardware options
    parser.add_argument("--device", "-d", choices=["cuda", "cpu", "auto"],
                        default="auto", help="Device for inference")

    args = parser.parse_args()

    # Validate input file
    if not Path(args.audio_file).exists():
        print(f"Error: Audio file not found: {args.audio_file}", file=sys.stderr)
        sys.exit(1)

    # Map clustering method
    clustering_map = {
        "agglomerative": ClusteringMethod.AGGLOMERATIVE,
        "spectral": ClusteringMethod.SPECTRAL,
        "online": ClusteringMethod.ONLINE_CENTROID
    }

    try:
        # Initialize system
        system = SpeakerDiarizationSystem(
            clustering_method=clustering_map[args.clustering],
            device=args.device,
            num_speakers=args.num_speakers,
            min_speakers=args.min_speakers,
            max_speakers=args.max_speakers,
            similarity_threshold=args.similarity_threshold,
            detect_overlaps=not args.no_overlap_detection,
            use_neural_pipeline=args.neural_pipeline
        )

        # Configure preprocessor
        if args.noise_reduction:
            system.preprocessor.apply_noise_reduction = True

        # Progress callback
        def progress(info):
            print(f"[{info['phase']}] {info['progress']*100:.0f}%", file=sys.stderr)

        # Run diarization
        print(f"Processing: {args.audio_file}", file=sys.stderr)
        result = system.diarize(
            args.audio_file,
            preprocess=args.preprocess,
            progress_callback=progress
        )

        # Format output
        if args.format == "json":
            output = json.dumps(result.to_dict(), indent=2, ensure_ascii=False)
        elif args.format == "text":
            output = result.format_output()
        elif args.format == "rttm":
            file_id = Path(args.audio_file).stem
            output = format_as_rttm(result, file_id)
        elif args.format == "srt":
            output = format_as_srt(result)
        else:
            output = json.dumps(result.to_dict(), indent=2)

        # Write output
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output)
            print(f"Output saved to: {args.output}", file=sys.stderr)
        else:
            print(output)

        # Print summary
        print(f"\nSummary:", file=sys.stderr)
        print(f"  Speakers detected: {result.num_speakers}", file=sys.stderr)
        print(f"  Total segments: {len(result.segments)}", file=sys.stderr)
        print(f"  Audio duration: {result.audio_duration:.1f}s", file=sys.stderr)
        print(f"  Processing time: {result.quality_metrics.processing_time_seconds:.1f}s", file=sys.stderr)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
