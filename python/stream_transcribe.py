#!/usr/bin/env python3
"""
stream_transcribe.py - Streaming audio transcription for live recordings

This module provides real-time streaming transcription by:
1. Accepting audio chunks via stdin or a named pipe
2. Buffering audio until enough data accumulates
3. Transcribing incrementally and outputting results as JSON lines

Usage:
    # Pipe audio data directly:
    cat audio.raw | python stream_transcribe.py --sample-rate 16000

    # Or use with a named pipe:
    python stream_transcribe.py --pipe /tmp/audio_pipe --sample-rate 16000

Output:
    JSON lines format, one result per transcription chunk:
    {"type": "segment", "text": "Hello world", "start": 0.0, "end": 1.5, "confidence": 0.95}
    {"type": "status", "message": "Processing...", "buffered_seconds": 5.2}
    {"type": "error", "message": "Error details"}
"""

# IMPORTANT: This must be the FIRST thing to happen before ANY other imports
# PyTorch 2.6+ changed the default weights_only=True for torch.load()
# We need to patch torch.load BEFORE any library imports torch
try:
    import functools
    import torch

    # Store the original torch.load function
    _original_torch_load = torch.load

    @functools.wraps(_original_torch_load)
    def _patched_torch_load(*args, **kwargs):
        # If weights_only is not explicitly specified, use False for compatibility
        # with pyannote.audio and whisperx models that use omegaconf configs
        if 'weights_only' not in kwargs:
            kwargs['weights_only'] = False
        return _original_torch_load(*args, **kwargs)

    # Apply the patch immediately
    torch.load = _patched_torch_load
except ImportError:
    pass
except Exception:
    pass

import argparse
import json
import sys
import os
import io
import tempfile
import wave
import struct
import threading
import queue
import time
import warnings
from typing import Optional, List, Dict, Any
from pathlib import Path

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

# Note: torch.load patch has been moved to the top of the file (before any imports)
# to ensure it's applied before whisperx or pyannote import torch

# Import numpy unconditionally (used for VAD functions)
import numpy as np

# Import resampling libraries for converting audio to WhisperX's expected 16kHz sample rate
# We try multiple options in order of preference: torchaudio > librosa > scipy
TORCHAUDIO_RESAMPLE_AVAILABLE = False
LIBROSA_AVAILABLE = False
SCIPY_AVAILABLE = False

try:
    import torchaudio
    import torchaudio.transforms as T
    TORCHAUDIO_RESAMPLE_AVAILABLE = True
except ImportError:
    pass

if not TORCHAUDIO_RESAMPLE_AVAILABLE:
    try:
        import librosa
        LIBROSA_AVAILABLE = True
    except ImportError:
        pass

if not TORCHAUDIO_RESAMPLE_AVAILABLE and not LIBROSA_AVAILABLE:
    try:
        from scipy import signal as scipy_signal
        SCIPY_AVAILABLE = True
    except ImportError:
        pass

# WhisperX expects 16kHz audio
WHISPERX_SAMPLE_RATE = 16000

# Attempt to import whisper libraries
WHISPERX_AVAILABLE = False
FASTER_WHISPER_AVAILABLE = False
_IMPORT_ERROR_MESSAGE = None

try:
    import whisperx
    import torch
    WHISPERX_AVAILABLE = True
except ImportError as e:
    _IMPORT_ERROR_MESSAGE = f"whisperx import failed: {e}"
except Exception as e:
    _IMPORT_ERROR_MESSAGE = f"whisperx import error ({type(e).__name__}): {e}"

if not WHISPERX_AVAILABLE:
    try:
        from faster_whisper import WhisperModel
        import torch
        FASTER_WHISPER_AVAILABLE = True
    except ImportError as e:
        if _IMPORT_ERROR_MESSAGE:
            _IMPORT_ERROR_MESSAGE += f"; faster_whisper import failed: {e}"
        else:
            _IMPORT_ERROR_MESSAGE = f"faster_whisper import failed: {e}"
    except Exception as e:
        if _IMPORT_ERROR_MESSAGE:
            _IMPORT_ERROR_MESSAGE += f"; faster_whisper import error ({type(e).__name__}): {e}"
        else:
            _IMPORT_ERROR_MESSAGE = f"faster_whisper import error ({type(e).__name__}): {e}"


def output_json(obj: Dict[str, Any]) -> None:
    """Output a JSON object as a line to stdout."""
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def output_status(message: str, **kwargs) -> None:
    """Output a status message."""
    output_json({"type": "status", "message": message, **kwargs})


def output_error(message: str, code: str = "ERROR") -> None:
    """Output an error message."""
    output_json({"type": "error", "message": message, "code": code})


def output_segment(text: str, start: float, end: float, confidence: float = None, words: List = None, speaker: str = None) -> None:
    """Output a transcribed segment."""
    # Console log for debugging - verify Whisper is transcribing audio
    speaker_info = f", speaker: {speaker}" if speaker else ""
    # Show full text but add ellipsis for very long segments
    display_text = text.strip()
    if len(display_text) > 150:
        display_text = display_text[:150] + "... [truncated]"
    print(f"[WHISPER OUTPUT] Transcribed segment: '{display_text}' (start: {start:.2f}s, end: {end:.2f}s, confidence: {confidence if confidence is not None else 'N/A'}{speaker_info})", file=sys.stderr, flush=True)

    result = {
        "type": "segment",
        "text": text.strip(),
        "start": start,
        "end": end,
    }
    if confidence is not None:
        result["confidence"] = confidence
    if words:
        result["words"] = words
    if speaker:
        result["speaker"] = speaker
    output_json(result)


# Attempt to import Silero VAD for better voice activity detection
SILERO_VAD_AVAILABLE = False
silero_vad_model = None
silero_get_speech_timestamps = None

try:
    # Silero VAD requires torch and torchaudio
    import torch
    import torchaudio
    # Try to load Silero VAD model
    silero_vad_model, silero_utils = torch.hub.load(
        repo_or_dir='snakers4/silero-vad',
        model='silero_vad',
        force_reload=False,
        onnx=False,
        trust_repo=True
    )
    (silero_get_speech_timestamps, _, silero_read_audio, *_) = silero_utils
    SILERO_VAD_AVAILABLE = True
except Exception as e:
    # Silero VAD not available, will use fallback energy-based detection
    pass


def detect_voice_activity_silero(audio_array: np.ndarray, sample_rate: int = 16000, is_system_audio: bool = False) -> bool:
    """
    Detect if there is voice activity in the audio using Silero VAD.

    Args:
        audio_array: Float32 numpy array of audio samples [-1, 1]
        sample_rate: Sample rate of the audio
        is_system_audio: If True, use more permissive settings for system audio
                        (audio from virtual cables like BlackHole may have different
                        characteristics than live microphone speech)

    Returns:
        True if voice activity is detected, False otherwise
    """
    if not SILERO_VAD_AVAILABLE or silero_vad_model is None:
        return True  # If VAD not available, assume there's speech

    # CRITICAL: First check if audio has any signal at all
    # If RMS is extremely low (< 0.0001), skip VAD and return False early
    # This prevents wasting time on Silero VAD for silent audio
    rms = np.sqrt(np.mean(audio_array ** 2))
    peak = np.max(np.abs(audio_array))
    db_rms = 20 * np.log10(max(rms, 1e-10))

    # If audio is essentially silent (below -80dB), log diagnostic and skip
    if rms < 0.0001:  # ~-80dB
        print(f"[WHISPER DEBUG] AUDIO CAPTURE ISSUE: Near-silent audio detected!", file=sys.stderr, flush=True)
        print(f"[WHISPER DEBUG]   RMS: {rms:.6f}, Peak: {peak:.6f}, dB: {db_rms:.1f}", file=sys.stderr, flush=True)
        print(f"[WHISPER DEBUG]   This indicates audio is not being captured properly.", file=sys.stderr, flush=True)
        print(f"[WHISPER DEBUG]   Check: (1) Microphone permissions, (2) Virtual cable routing,", file=sys.stderr, flush=True)
        print(f"[WHISPER DEBUG]          (3) Audio device settings, (4) Sample rate matching", file=sys.stderr, flush=True)
        # For silent audio, don't even try Silero VAD - it will fail anyway
        # But for permissive mode, let's try anyway in case there's faint audio
        if not is_system_audio:
            return False

    try:
        # Convert to torch tensor
        audio_tensor = torch.from_numpy(audio_array).float()

        # Use MUCH lower threshold for system audio (permissive mode) because:
        # 1. Pre-compressed audio from virtual cables has different acoustic characteristics
        # 2. Remote meeting participants' voices may not match Silero's training data
        # 3. System audio often includes processed/resampled speech
        # 4. Mixed audio (mic + system) may have interference patterns
        # 5. BlackHole and other virtual cables may have level issues
        #
        # For microphone: 0.5 threshold (standard)
        # For system audio/permissive: 0.15 threshold (very permissive)
        vad_threshold = 0.15 if is_system_audio else 0.5
        min_speech_ms = 100 if is_system_audio else 250  # Very short minimum for permissive
        speech_ratio_threshold = 0.01 if is_system_audio else 0.1  # Very low ratio for permissive

        # Get speech timestamps
        speech_timestamps = silero_get_speech_timestamps(
            audio_tensor,
            silero_vad_model,
            sampling_rate=sample_rate,
            threshold=vad_threshold,  # Confidence threshold for speech detection
            min_speech_duration_ms=min_speech_ms,  # Minimum speech duration to consider
            min_silence_duration_ms=100,  # Minimum silence duration between speech segments
        )

        # Calculate the percentage of audio that contains speech
        total_speech_duration = sum(
            (ts['end'] - ts['start']) for ts in speech_timestamps
        )
        total_duration = len(audio_array)
        speech_ratio = total_speech_duration / total_duration if total_duration > 0 else 0

        # Debug log for system audio VAD results (always log for permissive mode)
        if is_system_audio:
            print(f"[WHISPER DEBUG] System audio VAD: threshold={vad_threshold}, speech_ratio={speech_ratio:.3f}, min_required={speech_ratio_threshold}, timestamps={len(speech_timestamps)}, rms={rms:.4f}, db={db_rms:.1f}", file=sys.stderr, flush=True)

        # IMPORTANT: For permissive mode, if audio has reasonable energy but VAD finds nothing,
        # assume there might be speech we're missing (better false positive than false negative)
        if is_system_audio and speech_ratio < speech_ratio_threshold:
            # If RMS is above background noise level (-50dB), force pass through
            if rms > 0.003:  # ~-50dB, clearly audible
                print(f"[WHISPER DEBUG] VAD override: Audio has energy (RMS={rms:.4f}, dB={db_rms:.1f}) but VAD found no speech. Passing through anyway (permissive mode).", file=sys.stderr, flush=True)
                return True

        # Return True if audio contains enough speech
        return speech_ratio >= speech_ratio_threshold
    except Exception as e:
        # On error, assume there's speech to avoid dropping valid segments
        print(f"[WHISPER DEBUG] VAD error (assuming speech): {e}", file=sys.stderr, flush=True)
        return True


def resample_audio(audio_array: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """
    Resample audio from original sample rate to target sample rate.

    WhisperX expects 16kHz audio. This function resamples from any sample rate
    (e.g., 48kHz from microphone) to the expected 16kHz.

    Args:
        audio_array: Float32 numpy array of audio samples [-1, 1]
        orig_sr: Original sample rate (e.g., 48000)
        target_sr: Target sample rate (e.g., 16000)

    Returns:
        Resampled audio array at the target sample rate
    """
    if orig_sr == target_sr:
        return audio_array

    if TORCHAUDIO_RESAMPLE_AVAILABLE:
        # torchaudio provides high-quality resampling (already imported for Silero VAD)
        import torch
        # Convert numpy array to torch tensor
        audio_tensor = torch.from_numpy(audio_array).float()
        # Create resampler and apply
        resampler = T.Resample(orig_freq=orig_sr, new_freq=target_sr)
        resampled = resampler(audio_tensor)
        return resampled.numpy()
    elif LIBROSA_AVAILABLE:
        # librosa.resample handles the conversion cleanly
        return librosa.resample(audio_array, orig_sr=orig_sr, target_sr=target_sr)
    elif SCIPY_AVAILABLE:
        # Use scipy's resample for fallback
        # Calculate the number of samples in the resampled audio
        num_samples = int(len(audio_array) * target_sr / orig_sr)
        return scipy_signal.resample(audio_array, num_samples).astype(np.float32)
    else:
        # Last resort: simple decimation (low quality but works)
        # This is a very basic approach and should rarely be needed
        ratio = orig_sr / target_sr
        indices = np.arange(0, len(audio_array), ratio).astype(int)
        indices = indices[indices < len(audio_array)]
        return audio_array[indices]


def detect_voice_activity_energy(audio_array: np.ndarray, threshold: float = 0.005, is_permissive: bool = False) -> bool:
    """
    Simple energy-based voice activity detection as fallback.

    Args:
        audio_array: Float32 numpy array of audio samples [-1, 1]
        threshold: RMS energy threshold for considering audio as speech
                   Default lowered to 0.005 to be more permissive with quiet audio
        is_permissive: If True, use even lower threshold (for mixed/system audio)

    Returns:
        True if the audio energy is above threshold
    """
    if len(audio_array) == 0:
        return False

    # Calculate RMS energy
    rms = np.sqrt(np.mean(audio_array ** 2))
    peak = np.max(np.abs(audio_array))
    db_rms = 20 * np.log10(max(rms, 1e-10))

    # Use much lower threshold for permissive mode (mixed/system audio)
    # This catches quiet remote participants in video calls
    effective_threshold = 0.001 if is_permissive else threshold  # ~-60dB for permissive

    # Log diagnostic info for very quiet audio
    if rms < 0.001:
        print(f"[WHISPER DEBUG] Energy VAD: Very quiet audio - RMS: {rms:.6f}, Peak: {peak:.6f}, dB: {db_rms:.1f}, threshold: {effective_threshold}", file=sys.stderr, flush=True)

    # Check if energy is above threshold
    return rms > effective_threshold


def is_likely_hallucination(text: str, confidence: Optional[float] = None) -> bool:
    """
    Detect if transcribed text is likely a hallucination.

    Whisper models sometimes hallucinate common phrases, especially when:
    - Audio quality is poor or there's no actual speech
    - Background noise is present
    - Long silences occur during recording

    This function filters out common hallucination patterns including:
    - Empty or very short text
    - Low confidence scores (< 0.3)
    - Common YouTube/video phrases (e.g., "Thanks for watching")
    - Music/sound indicators that Whisper incorrectly transcribes
    - Highly repetitive text patterns

    Args:
        text: The transcribed text to check
        confidence: Optional confidence score (0.0-1.0)

    Returns:
        True if the text is likely a hallucination and should be filtered
    """
    if not text or not text.strip():
        return True

    text_lower = text.lower().strip()

    # Check for minimum confidence threshold (lowered to 0.3 to be more permissive)
    if confidence is not None and confidence < 0.3:
        return True

    # Common Whisper hallucination patterns
    hallucination_patterns = [
        # Empty/filler patterns
        "thank you for watching",
        "thanks for watching",
        "please subscribe",
        "like and subscribe",
        "see you next time",
        "goodbye",
        "bye bye",
        "thank you",
        "subtitles by",
        "captions by",
        "transcribed by",
        # Music/sound descriptions that Whisper hallucinates
        "music playing",
        "music",
        "[music]",
        "(music)",
        "♪",
        "♫",
        # Repetitive sounds (common hallucinations)
        "la la la",
        "na na na",
        "da da da",
        "oh oh oh",
        "oh, oh, oh",
        "ah ah ah",
        "i am an angel",
        "for each i am",
        # Song-like patterns
        "the crap out",
    ]

    for pattern in hallucination_patterns:
        if pattern in text_lower:
            return True

    # Check for highly repetitive text (hallucination indicator)
    words = text_lower.split()
    if len(words) >= 4:
        # Check if the same phrase repeats
        word_counts = {}
        for word in words:
            word_counts[word] = word_counts.get(word, 0) + 1

        # If any word appears more than 50% of the time, it's likely repetitive
        max_count = max(word_counts.values()) if word_counts else 0
        if max_count > len(words) * 0.5:
            return True

        # Check for repeating n-grams (2-3 word phrases)
        for n in [2, 3]:
            if len(words) >= n * 2:
                ngrams = [' '.join(words[i:i+n]) for i in range(len(words) - n + 1)]
                ngram_counts = {}
                for ngram in ngrams:
                    ngram_counts[ngram] = ngram_counts.get(ngram, 0) + 1

                # If any n-gram repeats more than 3 times, it's likely hallucination
                max_ngram_count = max(ngram_counts.values()) if ngram_counts else 0
                if max_ngram_count >= 3:
                    return True

    return False


class StreamingTranscriber:
    """
    Streaming transcription handler.

    Buffers incoming audio and transcribes when enough data has accumulated.
    Includes VAD (Voice Activity Detection), hallucination filtering,
    and optional speaker diarization for real-time speaker identification.

    IMPORTANT: This class now properly handles buffered audio synchronization
    to fix the 35-second audio repetition bug. When audio is buffered while
    the model loads, the initial_time_offset parameter ensures timestamps
    are calculated correctly from the start of the recording.
    """

    def __init__(
        self,
        model_size: str = "base",
        language: str = "en",
        sample_rate: int = 16000,
        channels: int = 1,
        bit_depth: int = 16,
        chunk_duration: float = 5.0,  # Process every 5 seconds of audio
        device: Optional[str] = None,
        confidence_threshold: float = 0.3,  # Minimum confidence to accept a segment (lowered from 0.4)
        use_vad: bool = True,  # Enable Voice Activity Detection
        permissive_vad: bool = False,  # Use lower VAD threshold for system audio transcription
        enable_diarization: bool = False,  # Enable real-time speaker diarization
        # Lower threshold = more speakers detected (more sensitive to voice differences)
        # Default 0.5 provides better speaker separation than pyannote's default of 0.7
        diarization_similarity_threshold: float = 0.5,
        max_speakers: int = 10,  # Maximum number of speakers to track
        initial_time_offset: float = 0.0  # Initial time offset for buffered audio synchronization
    ):
        self.model_size = model_size
        self.language = language
        self.sample_rate = sample_rate
        self.channels = channels
        self.bit_depth = bit_depth
        self.chunk_duration = chunk_duration
        self.bytes_per_sample = bit_depth // 8
        self.bytes_per_frame = self.bytes_per_sample * channels
        self.chunk_bytes = int(chunk_duration * sample_rate * self.bytes_per_frame)

        # Initial time offset for buffered audio synchronization
        # This is used to correctly timestamp audio that was buffered while the model was loading
        # Fixes the 35-second audio repetition bug
        self.initial_time_offset = initial_time_offset

        # Deduplication: Track last transcribed words to avoid repetition
        # This catches cases where consecutive segments repeat the same words
        self.last_transcribed_words: List[str] = []
        self.max_dedup_words = 10  # Track last 10 words for deduplication

        # Track processed segment times to prevent duplicate outputs
        # This prevents the same audio segment from being transcribed twice
        self.processed_segment_times: set = set()

        # Track processed speaker segments to prevent duplicates in diarization
        # This is part of the fix for the 35-second audio repetition bug
        self._processed_speaker_segments: set = set()

        # Debug: Log configuration at init
        print(f"[WHISPER DEBUG] StreamingTranscriber initialized:", file=sys.stderr, flush=True)
        print(f"[WHISPER DEBUG]   sample_rate={sample_rate}, channels={channels}, bit_depth={bit_depth}", file=sys.stderr, flush=True)
        print(f"[WHISPER DEBUG]   chunk_duration={chunk_duration}s, chunk_bytes={self.chunk_bytes} ({self.chunk_bytes/1024:.1f} KB)", file=sys.stderr, flush=True)
        print(f"[WHISPER DEBUG]   bytes_per_sample={self.bytes_per_sample}, bytes_per_frame={self.bytes_per_frame}", file=sys.stderr, flush=True)

        # Hallucination prevention settings
        self.confidence_threshold = confidence_threshold
        self.use_vad = use_vad
        self.permissive_vad = permissive_vad  # Lower VAD threshold for system audio

        # Speaker diarization settings
        self.enable_diarization = enable_diarization
        self.diarizer = None
        self.recent_speaker_segments: List[Dict[str, Any]] = []  # Track recent speaker segments for alignment

        # Auto-detect device
        if device is None:
            if WHISPERX_AVAILABLE or FASTER_WHISPER_AVAILABLE:
                import torch
                self.device = "cuda" if torch.cuda.is_available() else "cpu"
            else:
                self.device = "cpu"
        else:
            self.device = device

        self.model = None
        self.audio_buffer = bytearray()
        self.total_processed_samples = 0
        self.is_running = True

        # Backend selection
        if WHISPERX_AVAILABLE:
            self.backend = "whisperx"
        elif FASTER_WHISPER_AVAILABLE:
            self.backend = "faster-whisper"
        else:
            self.backend = None

        # Log VAD availability
        if self.use_vad:
            vad_mode = "permissive (system audio)" if self.permissive_vad else "standard"
            if SILERO_VAD_AVAILABLE:
                output_status(f"Silero VAD enabled ({vad_mode} mode)")
            else:
                output_status(f"Using energy-based VAD ({vad_mode} mode, Silero not available)")

        # Initialize diarization if enabled
        if self.enable_diarization:
            self._init_diarization(diarization_similarity_threshold, max_speakers)

    def _init_diarization(self, similarity_threshold: float, max_speakers: int) -> None:
        """Initialize the live diarization module.

        This method initializes real speaker diarization using voice embeddings.
        If diarization cannot be initialized, it outputs a mandatory disclosure
        message as required by the audio processing specification.
        """
        try:
            from live_diarize import LiveDiarizer, PYANNOTE_AVAILABLE, SPEECHBRAIN_AVAILABLE

            # Check if speaker embedding backends are available
            if not PYANNOTE_AVAILABLE and not SPEECHBRAIN_AVAILABLE:
                # MANDATORY FAILURE DISCLOSURE
                # Speaker diarization requires embedding extraction which is not available
                output_json({
                    "type": "diarization_unavailable",
                    "message": "Speaker diarization is not supported in the current audio processing pipeline. Only transcription is available.",
                    "reason": "no_embedding_backend",
                    "details": "Neither pyannote.audio nor speechbrain speaker embedding models are available. Install either: pip install pyannote.audio or pip install speechbrain",
                    "capabilities": {
                        "speaker_embeddings": False,
                        "speaker_clustering": False,
                        "speaker_change_detection": False,
                        "transcription_only": True
                    }
                })
                self.enable_diarization = False
                self.diarizer = None
                return

            # Check for HF_TOKEN when pyannote is available
            hf_token = os.environ.get("HF_TOKEN")
            if PYANNOTE_AVAILABLE and not hf_token:
                output_json({
                    "type": "diarization_unavailable",
                    "message": "Speaker diarization requires Hugging Face authentication. Please set up your HF_TOKEN.",
                    "reason": "authentication_required",
                    "details": "The pyannote/embedding model requires Hugging Face authentication. "
                              "Please: 1) Create a Hugging Face account at https://huggingface.co/join, "
                              "2) Accept the model license at https://huggingface.co/pyannote/embedding, "
                              "3) Create an access token at https://huggingface.co/settings/tokens, "
                              "4) Save your token in Meeting Notes Settings > Audio > Speaker Identification.",
                    "capabilities": {
                        "speaker_embeddings": False,
                        "speaker_clustering": False,
                        "speaker_change_detection": False,
                        "transcription_only": True
                    }
                })
                # Try SpeechBrain as fallback if available
                if SPEECHBRAIN_AVAILABLE:
                    output_status("Attempting to use SpeechBrain as fallback (no HF_TOKEN required)...")
                else:
                    self.enable_diarization = False
                    self.diarizer = None
                    return

            self.diarizer = LiveDiarizer(
                sample_rate=self.sample_rate,
                segment_duration=2.0,  # 2 second segments for speaker embedding
                hop_duration=0.5,  # 0.5 second hop
                similarity_threshold=similarity_threshold,
                max_speakers=max_speakers,
                device=self.device
            )

            # Check if diarizer actually loaded successfully (embedding_extractor has a backend)
            if self.diarizer.embedding_extractor.backend is None:
                # The diarizer was created but embedding model failed to load
                output_json({
                    "type": "diarization_unavailable",
                    "message": "Speaker diarization failed to initialize. The embedding model could not be loaded.",
                    "reason": "model_load_failed",
                    "details": "The speaker embedding model failed to load. This may be due to authentication issues with Hugging Face. "
                              "Please check that: 1) Your HF_TOKEN is valid, 2) You have accepted the model license at https://huggingface.co/pyannote/embedding",
                    "capabilities": {
                        "speaker_embeddings": False,
                        "speaker_clustering": False,
                        "speaker_change_detection": False,
                        "transcription_only": True
                    }
                })
                self.enable_diarization = False
                self.diarizer = None
                return

            # Report diarization capabilities
            output_json({
                "type": "diarization_available",
                "message": f"Speaker diarization enabled with embedding-based speaker identification",
                "capabilities": {
                    "speaker_embeddings": True,
                    "speaker_clustering": True,
                    "speaker_change_detection": True,
                    "transcription_only": False,
                    "max_speakers": max_speakers,
                    "similarity_threshold": similarity_threshold,
                    "embedding_backend": self.diarizer.embedding_extractor.backend
                }
            })
            output_status(f"Speaker diarization enabled (max {max_speakers} speakers, threshold {similarity_threshold})")
        except ImportError as e:
            # MANDATORY FAILURE DISCLOSURE
            output_json({
                "type": "diarization_unavailable",
                "message": "Speaker diarization is not supported in the current audio processing pipeline. Only transcription is available.",
                "reason": "import_error",
                "details": str(e),
                "capabilities": {
                    "speaker_embeddings": False,
                    "speaker_clustering": False,
                    "speaker_change_detection": False,
                    "transcription_only": True
                }
            })
            self.enable_diarization = False
            self.diarizer = None
        except Exception as e:
            error_str = str(e).lower()
            # Check for authentication-related errors
            if any(keyword in error_str for keyword in [
                'could not download', 'authenticate', 'gated', 'private',
                '401', '403', 'unauthorized', 'forbidden', 'access token',
                'hf.co/settings/tokens', 'accept the license'
            ]):
                output_json({
                    "type": "diarization_unavailable",
                    "message": "Speaker diarization requires Hugging Face authentication.",
                    "reason": "authentication_required",
                    "details": f"Failed to download model due to authentication: {e}. "
                              "Please: 1) Create a Hugging Face account at https://huggingface.co/join, "
                              "2) Accept the model license at https://huggingface.co/pyannote/embedding, "
                              "3) Create an access token at https://huggingface.co/settings/tokens, "
                              "4) Save your token in Meeting Notes Settings > Audio > Speaker Identification.",
                    "capabilities": {
                        "speaker_embeddings": False,
                        "speaker_clustering": False,
                        "speaker_change_detection": False,
                        "transcription_only": True
                    }
                })
            else:
                # MANDATORY FAILURE DISCLOSURE
                output_json({
                    "type": "diarization_unavailable",
                    "message": "Speaker diarization is not supported in the current audio processing pipeline. Only transcription is available.",
                    "reason": "initialization_error",
                    "details": str(e),
                    "capabilities": {
                        "speaker_embeddings": False,
                        "speaker_clustering": False,
                        "speaker_change_detection": False,
                        "transcription_only": True
                    }
                })
            self.enable_diarization = False
            self.diarizer = None

    def load_model(self) -> bool:
        """Load the transcription model."""
        if self.backend is None:
            output_error("No transcription backend available. Install whisperx or faster-whisper.", "NO_BACKEND")
            return False

        try:
            output_status(f"Loading {self.backend} model '{self.model_size}' on {self.device}...")

            compute_type = "float16" if self.device == "cuda" else "float32"

            if self.backend == "whisperx":
                self.model = whisperx.load_model(
                    self.model_size,
                    self.device,
                    compute_type=compute_type,
                    language=self.language
                )
            else:
                self.model = WhisperModel(
                    self.model_size,
                    device=self.device,
                    compute_type=compute_type
                )

            output_status(f"Model loaded successfully", backend=self.backend, device=self.device)
            return True

        except Exception as e:
            output_error(f"Failed to load model: {str(e)}", "MODEL_LOAD_ERROR")
            return False

    def bytes_to_float_array(self, audio_bytes: bytes) -> np.ndarray:
        """Convert raw PCM bytes to float32 numpy array."""
        if self.bit_depth == 16:
            # 16-bit signed integer
            dtype = np.int16
            max_val = 32768.0
        elif self.bit_depth == 32:
            dtype = np.int32
            max_val = 2147483648.0
        else:
            dtype = np.int16
            max_val = 32768.0

        audio_array = np.frombuffer(audio_bytes, dtype=dtype)

        # Convert to mono if stereo
        if self.channels == 2:
            audio_array = audio_array.reshape(-1, 2).mean(axis=1).astype(dtype)

        # Normalize to float32 [-1, 1]
        return audio_array.astype(np.float32) / max_val

    def create_temp_wav(self, audio_bytes: bytes) -> str:
        """Create a temporary WAV file from raw audio bytes."""
        temp_fd, temp_path = tempfile.mkstemp(suffix=".wav")
        try:
            with wave.open(temp_path, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Always mono for transcription
                wav_file.setsampwidth(self.bytes_per_sample)
                wav_file.setframerate(self.sample_rate)

                # Convert stereo to mono if needed
                if self.channels == 2:
                    audio_array = np.frombuffer(audio_bytes, dtype=np.int16)
                    mono = audio_array.reshape(-1, 2).mean(axis=1).astype(np.int16)
                    wav_file.writeframes(mono.tobytes())
                else:
                    wav_file.writeframes(audio_bytes)

            return temp_path
        finally:
            os.close(temp_fd)

    def calculate_audio_levels(self, audio_array: np.ndarray) -> Dict[str, float]:
        """
        Calculate audio levels (RMS and peak) for diagnostics.

        Args:
            audio_array: Float32 numpy array of audio samples [-1, 1]

        Returns:
            Dictionary with rms, peak, and db_rms values
        """
        if len(audio_array) == 0:
            return {"rms": 0.0, "peak": 0.0, "db_rms": -100.0}

        rms = np.sqrt(np.mean(audio_array ** 2))
        peak = np.max(np.abs(audio_array))

        # Convert to dB (with floor to avoid log(0))
        db_rms = 20 * np.log10(max(rms, 1e-10))

        return {
            "rms": float(rms),
            "peak": float(peak),
            "db_rms": float(db_rms)
        }

    def deduplicate_text(self, text: str) -> str:
        """
        Remove repeated words from the beginning of new transcription text.

        This handles cases where consecutive audio chunks produce overlapping
        transcriptions (e.g., chunk N ends with "the quick brown" and chunk N+1
        starts with "the quick brown fox" - we want to output just "fox").

        Args:
            text: The transcribed text from the current chunk

        Returns:
            Text with repeated prefix words removed
        """
        if not self.last_transcribed_words or not text:
            return text

        # Split new text into words
        new_words = text.split()
        if not new_words:
            return text

        # Find the longest matching prefix
        # Check if the beginning of new_words matches the end of last_transcribed_words
        max_overlap = min(len(new_words), len(self.last_transcribed_words))
        overlap_length = 0

        for i in range(1, max_overlap + 1):
            # Check if first i words of new text match last i words of previous text
            new_prefix = new_words[:i]
            old_suffix = self.last_transcribed_words[-i:]

            # Case-insensitive comparison
            if [w.lower().strip('.,!?;:') for w in new_prefix] == [w.lower().strip('.,!?;:') for w in old_suffix]:
                overlap_length = i

        if overlap_length > 0:
            # Remove the overlapping words from the beginning
            deduplicated_words = new_words[overlap_length:]
            deduplicated_text = ' '.join(deduplicated_words)
            print(f"[WHISPER DEBUG] Deduplication: removed {overlap_length} repeated words from start", file=sys.stderr, flush=True)
            print(f"[WHISPER DEBUG]   Original: '{text[:50]}...'", file=sys.stderr, flush=True)
            print(f"[WHISPER DEBUG]   Cleaned:  '{deduplicated_text[:50]}...'", file=sys.stderr, flush=True)
            return deduplicated_text

        return text

    def update_last_words(self, text: str) -> None:
        """Update the tracking of last transcribed words for deduplication."""
        if not text:
            return

        words = text.split()
        # Keep only the last N words
        self.last_transcribed_words = words[-self.max_dedup_words:] if words else []

    def transcribe_chunk(self, audio_bytes: bytes) -> List[Dict[str, Any]]:
        """
        Transcribe a chunk of audio and return segments.

        This method includes:
        1. VAD (Voice Activity Detection) to skip chunks without speech
        2. Hallucination filtering to remove likely false transcriptions
        3. Confidence threshold filtering to remove low-quality segments
        """
        if self.model is None:
            print(f"[WHISPER DEBUG] transcribe_chunk called but model is None!", file=sys.stderr, flush=True)
            return []

        segments = []
        temp_path = None

        # Debug: Log when transcribe_chunk is called
        print(f"[WHISPER DEBUG] transcribe_chunk called with {len(audio_bytes)} bytes", file=sys.stderr, flush=True)

        try:
            # Convert audio bytes to float array for processing
            audio = self.bytes_to_float_array(audio_bytes)
            print(f"[WHISPER DEBUG] Converted to float array with {len(audio)} samples, duration: {len(audio)/self.sample_rate:.2f}s", file=sys.stderr, flush=True)

            # Calculate and log audio levels for diagnostics
            levels = self.calculate_audio_levels(audio)
            print(f"[WHISPER DEBUG] Audio levels - RMS: {levels['rms']:.4f}, Peak: {levels['peak']:.4f}, dB: {levels['db_rms']:.1f}", file=sys.stderr, flush=True)

            if levels["db_rms"] < -60:
                # Very quiet audio - might indicate input issues
                output_status(f"Low audio level detected: {levels['db_rms']:.1f} dB RMS",
                            rms=levels["rms"], peak=levels["peak"], db_rms=levels["db_rms"])

            # Step 1: Voice Activity Detection
            # Skip transcription if no voice is detected in the chunk
            if self.use_vad:
                has_voice = False
                vad_mode = "permissive" if self.permissive_vad else "standard"
                print(f"[WHISPER DEBUG] Running VAD check (Silero available: {SILERO_VAD_AVAILABLE}, mode: {vad_mode})", file=sys.stderr, flush=True)

                # CRITICAL: For permissive mode with extremely quiet audio, bypass VAD entirely
                # This handles cases where audio routing issues cause near-silent input
                # RMS < 0.0001 means essentially no signal (~-80dB)
                if self.permissive_vad and levels['rms'] < 0.0001:
                    print(f"[WHISPER DEBUG] AUDIO CAPTURE PROBLEM DETECTED!", file=sys.stderr, flush=True)
                    print(f"[WHISPER DEBUG]   Audio is near-silent: RMS={levels['rms']:.6f}, dB={levels['db_rms']:.1f}", file=sys.stderr, flush=True)
                    print(f"[WHISPER DEBUG]   This usually means:", file=sys.stderr, flush=True)
                    print(f"[WHISPER DEBUG]   1. Microphone is not capturing audio (check permissions)", file=sys.stderr, flush=True)
                    print(f"[WHISPER DEBUG]   2. System audio routing is wrong (check BlackHole/virtual cable)", file=sys.stderr, flush=True)
                    print(f"[WHISPER DEBUG]   3. Sample rate mismatch corrupting audio data", file=sys.stderr, flush=True)
                    print(f"[WHISPER DEBUG]   4. Audio mixer not receiving data from both sources", file=sys.stderr, flush=True)
                    # Still try to process in case there's ultra-quiet valid audio
                    # but warn the user about the capture issue
                    output_status(f"AUDIO CAPTURE ISSUE: Near-silent audio (RMS: {levels['rms']:.6f}, dB: {levels['db_rms']:.1f}). Check audio device configuration.",
                                has_voice=False, rms=levels["rms"], db_rms=levels["db_rms"], capture_issue=True)

                if SILERO_VAD_AVAILABLE:
                    # Pass permissive_vad flag to use lower threshold for system audio
                    has_voice = detect_voice_activity_silero(audio, self.sample_rate, is_system_audio=self.permissive_vad)
                    print(f"[WHISPER DEBUG] Silero VAD result: has_voice={has_voice} (mode: {vad_mode})", file=sys.stderr, flush=True)
                else:
                    # Use even lower threshold for permissive mode (system audio)
                    energy_threshold = 0.001 if self.permissive_vad else 0.005  # Lower threshold for permissive
                    has_voice = detect_voice_activity_energy(audio, threshold=energy_threshold, is_permissive=self.permissive_vad)
                    print(f"[WHISPER DEBUG] Energy VAD result: has_voice={has_voice} (threshold: {energy_threshold}, permissive: {self.permissive_vad})", file=sys.stderr, flush=True)

                if not has_voice:
                    # Log more details about why VAD rejected the chunk
                    print(f"[WHISPER DEBUG] VAD rejected chunk - no voice detected (mode: {vad_mode})", file=sys.stderr, flush=True)
                    output_status(f"No voice activity detected (RMS: {levels['rms']:.4f}, dB: {levels['db_rms']:.1f}), skipping chunk",
                                has_voice=False, rms=levels["rms"], db_rms=levels["db_rms"])
                    # Still update processed samples count
                    num_samples = len(audio_bytes) // self.bytes_per_frame
                    self.total_processed_samples += num_samples
                    return []
                else:
                    print(f"[WHISPER DEBUG] VAD passed - voice detected, proceeding to transcription", file=sys.stderr, flush=True)

            # Calculate time offset based on previously processed samples
            time_offset = self.total_processed_samples / self.sample_rate
            print(f"[WHISPER DEBUG] Time offset: {time_offset:.2f}s, backend: {self.backend}", file=sys.stderr, flush=True)

            if self.backend == "whisperx":
                # WhisperX expects 16kHz audio - resample if necessary
                # This is critical: WhisperX's internal pyannote VAD assumes 16kHz
                # Without resampling, the VAD fails to detect speech in higher sample rate audio
                if self.sample_rate != WHISPERX_SAMPLE_RATE:
                    print(f"[WHISPER DEBUG] Resampling audio from {self.sample_rate}Hz to {WHISPERX_SAMPLE_RATE}Hz for WhisperX", file=sys.stderr, flush=True)
                    audio_for_whisperx = resample_audio(audio, self.sample_rate, WHISPERX_SAMPLE_RATE)
                    print(f"[WHISPER DEBUG] Resampled: {len(audio)} samples -> {len(audio_for_whisperx)} samples", file=sys.stderr, flush=True)
                else:
                    audio_for_whisperx = audio

                # WhisperX can work with numpy arrays
                print(f"[WHISPER DEBUG] Calling whisperx.transcribe() with audio shape: {audio_for_whisperx.shape}, target_sample_rate: {WHISPERX_SAMPLE_RATE}", file=sys.stderr, flush=True)
                result = self.model.transcribe(audio_for_whisperx, batch_size=8)
                print(f"[WHISPER DEBUG] WhisperX returned result with {len(result.get('segments', []))} segments", file=sys.stderr, flush=True)
                print(f"[WHISPER DEBUG] Raw result keys: {result.keys()}", file=sys.stderr, flush=True)
                if result.get("segments"):
                    print(f"[WHISPER DEBUG] First segment preview: {result['segments'][0] if result['segments'] else 'None'}", file=sys.stderr, flush=True)

                for seg in result.get("segments", []):
                    text = seg.get("text", "").strip()
                    confidence = seg.get("confidence")

                    # Calculate confidence from word scores if not provided
                    if confidence is None:
                        words = seg.get("words", [])
                        if words:
                            scores = [w.get("score") for w in words if w.get("score") is not None]
                            if scores:
                                confidence = sum(scores) / len(scores)

                    # Step 2: Filter out hallucinations
                    if is_likely_hallucination(text, confidence):
                        display_text = text[:50] + "..." if len(text) > 50 else text
                        output_status(f"[FILTER] Hallucination detected and filtered: '{display_text}'", filtered=True)
                        continue

                    # Step 3: Apply confidence threshold
                    if confidence is not None and confidence < self.confidence_threshold:
                        display_text = text[:50] + "..." if len(text) > 50 else text
                        output_status(f"[FILTER] Low confidence ({confidence:.2f}): '{display_text}'", filtered=True)
                        continue

                    # Step 4: Deduplicate - remove repeated words from previous chunk
                    text = self.deduplicate_text(text)

                    # Skip if deduplication removed all content
                    if not text.strip():
                        continue

                    # Update last words for next deduplication check
                    self.update_last_words(text)

                    # Calculate the actual segment times
                    seg_start = seg.get("start", 0) + time_offset
                    seg_end = seg.get("end", 0) + time_offset

                    # CRITICAL: Check for duplicate segments to fix the audio repetition bug
                    # This prevents the same time range from being output twice when
                    # buffered audio is flushed and then live audio continues
                    segment_key = f"{seg_start:.2f}-{seg_end:.2f}"
                    if segment_key in self.processed_segment_times:
                        print(f"[WHISPER DEBUG] Skipping duplicate segment: {segment_key}", file=sys.stderr, flush=True)
                        continue

                    self.processed_segment_times.add(segment_key)

                    segments.append({
                        "text": text,
                        "start": seg_start,
                        "end": seg_end,
                        "confidence": confidence,
                        "words": seg.get("words", [])
                    })
            else:
                # faster-whisper needs a file
                temp_path = self.create_temp_wav(audio_bytes)

                segments_iter, info = self.model.transcribe(
                    temp_path,
                    language=self.language,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=True
                )

                for seg in segments_iter:
                    word_data = []
                    confidence = None

                    if seg.words:
                        word_data = [
                            {"word": w.word, "start": w.start + time_offset, "end": w.end + time_offset, "score": w.probability}
                            for w in seg.words
                        ]
                        scores = [w.probability for w in seg.words if w.probability is not None]
                        if scores:
                            confidence = sum(scores) / len(scores)

                    text = seg.text.strip()

                    # Step 2: Filter out hallucinations
                    if is_likely_hallucination(text, confidence):
                        display_text = text[:50] + "..." if len(text) > 50 else text
                        output_status(f"[FILTER] Hallucination detected and filtered: '{display_text}'", filtered=True)
                        continue

                    # Step 3: Apply confidence threshold
                    if confidence is not None and confidence < self.confidence_threshold:
                        display_text = text[:50] + "..." if len(text) > 50 else text
                        output_status(f"[FILTER] Low confidence ({confidence:.2f}): '{display_text}'", filtered=True)
                        continue

                    # Step 4: Deduplicate - remove repeated words from previous chunk
                    text = self.deduplicate_text(text)

                    # Skip if deduplication removed all content
                    if not text.strip():
                        continue

                    # Update last words for next deduplication check
                    self.update_last_words(text)

                    # Calculate the actual segment times
                    seg_start = seg.start + time_offset
                    seg_end = seg.end + time_offset

                    # CRITICAL: Check for duplicate segments to fix the audio repetition bug
                    # This prevents the same time range from being output twice when
                    # buffered audio is flushed and then live audio continues
                    segment_key = f"{seg_start:.2f}-{seg_end:.2f}"
                    if segment_key in self.processed_segment_times:
                        print(f"[WHISPER DEBUG] Skipping duplicate segment: {segment_key}", file=sys.stderr, flush=True)
                        continue

                    self.processed_segment_times.add(segment_key)

                    segments.append({
                        "text": text,
                        "start": seg_start,
                        "end": seg_end,
                        "confidence": confidence,
                        "words": word_data
                    })

            # Update processed samples count
            num_samples = len(audio_bytes) // self.bytes_per_frame
            self.total_processed_samples += num_samples

            # Step 5: Speaker diarization - assign speakers to segments
            if self.enable_diarization and self.diarizer and segments:
                self._process_diarization(audio, segments)

        except Exception as e:
            output_error(f"Transcription error: {str(e)}", "TRANSCRIBE_ERROR")
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except:
                    pass

        return segments

    def _process_diarization(self, audio: np.ndarray, segments: List[Dict[str, Any]]) -> None:
        """
        Process audio through diarizer and assign speakers to transcript segments.

        IMPORTANT: This method now properly handles buffered audio synchronization
        to fix the 35-second audio repetition bug. Speaker segments are deduplicated
        to ensure accurate speaker assignment when audio is flushed from the buffer.

        Args:
            audio: Float32 numpy array of audio
            segments: List of transcript segments to assign speakers to
        """
        try:
            # Add audio to diarizer and get speaker segments
            speaker_segments = self.diarizer.add_audio(audio)

            # Deduplicate speaker segments based on time ranges
            # This prevents the same speaker segment from being added twice
            # when buffered audio is processed alongside live audio
            for seg in speaker_segments:
                # Create a unique key for this segment based on time range
                seg_key = f"{seg['start']:.2f}-{seg['end']:.2f}"
                if seg_key in self._processed_speaker_segments:
                    print(f"[DIARIZE DEBUG] Skipping duplicate speaker segment: {seg_key}", file=sys.stderr, flush=True)
                    continue

                self._processed_speaker_segments.add(seg_key)
                self.recent_speaker_segments.append(seg)

            # Limit to last 300 seconds (5 minutes) of segments to prevent memory issues
            # while still providing enough history for accurate speaker identification
            MAX_SPEAKER_HISTORY_SECONDS = 300.0
            current_time = self.total_processed_samples / self.sample_rate
            if current_time > MAX_SPEAKER_HISTORY_SECONDS:
                cutoff_time = current_time - MAX_SPEAKER_HISTORY_SECONDS
                # Also clean up the processed segments set to prevent memory growth
                self.recent_speaker_segments = [
                    s for s in self.recent_speaker_segments if s["end"] > cutoff_time
                ]
                # Clean up old entries from the processed segments set
                self._processed_speaker_segments = {
                    key for key in self._processed_speaker_segments
                    if float(key.split('-')[1]) > cutoff_time
                }

            # Assign speakers to transcript segments using overlap matching
            for seg in segments:
                speaker, confidence = self.diarizer.assign_speaker_to_transcript(
                    seg["start"],
                    seg["end"],
                    self.recent_speaker_segments
                )
                if speaker:
                    seg["speaker"] = speaker
                    seg["speaker_confidence"] = confidence

        except Exception as e:
            print(f"[DIARIZE DEBUG] Error processing diarization: {e}", file=sys.stderr, flush=True)

    def add_audio(self, audio_data: bytes) -> None:
        """Add audio data to the buffer."""
        self.audio_buffer.extend(audio_data)

    def process_buffer(self) -> List[Dict[str, Any]]:
        """Process buffered audio if we have enough data."""
        buffer_len = len(self.audio_buffer)
        chunk_bytes_needed = self.chunk_bytes

        # Debug: Log buffer status periodically (every ~50 calls)
        if not hasattr(self, '_process_buffer_call_count'):
            self._process_buffer_call_count = 0
        self._process_buffer_call_count += 1

        if self._process_buffer_call_count % 50 == 1:
            buffer_duration = buffer_len / (self.sample_rate * self.bytes_per_frame)
            print(f"[WHISPER DEBUG] process_buffer: buffer={buffer_len} bytes ({buffer_duration:.2f}s), need={chunk_bytes_needed} bytes ({self.chunk_duration}s)", file=sys.stderr, flush=True)

        if buffer_len < chunk_bytes_needed:
            return []

        print(f"[WHISPER DEBUG] Buffer threshold reached! Processing {chunk_bytes_needed} bytes of audio...", file=sys.stderr, flush=True)

        # Extract chunk_bytes worth of audio
        chunk = bytes(self.audio_buffer[:self.chunk_bytes])
        # Remove processed audio from buffer - NO OVERLAP
        # Previously we kept 0.5s overlap for "context" but this caused word repetition
        # because Whisper would transcribe the same audio twice (end of chunk N = start of chunk N+1)
        self.audio_buffer = self.audio_buffer[self.chunk_bytes:]

        return self.transcribe_chunk(chunk)

    def process_remaining(self) -> List[Dict[str, Any]]:
        """Process any remaining audio in the buffer."""
        if len(self.audio_buffer) < self.bytes_per_frame * self.sample_rate:  # At least 1 second
            return []

        chunk = bytes(self.audio_buffer)
        self.audio_buffer.clear()
        return self.transcribe_chunk(chunk)

    def get_buffer_duration(self) -> float:
        """Get the current buffer duration in seconds."""
        return len(self.audio_buffer) / (self.sample_rate * self.bytes_per_frame)


def read_stdin_audio(transcriber: StreamingTranscriber, read_size: int = 4096) -> None:
    """Read audio from stdin and process it."""
    output_status("Waiting for audio data on stdin...")
    print(f"[WHISPER DEBUG] read_stdin_audio started, waiting for data...", file=sys.stderr, flush=True)

    # Audio diagnostics tracking
    total_bytes_received = 0
    total_chunks_received = 0
    segments_produced = 0
    last_status_time = time.time()
    STATUS_INTERVAL = 10.0  # Log status every 10 seconds

    try:
        while transcriber.is_running:
            # Read raw audio bytes from stdin
            # Use non-blocking-ish approach: read whatever is available up to read_size
            data = sys.stdin.buffer.read(read_size)

            if not data:
                # End of input
                print(f"[WHISPER DEBUG] End of stdin - no more data", file=sys.stderr, flush=True)
                output_status(f"End of audio stream. Total received: {total_bytes_received / 1024:.1f} KB in {total_chunks_received} chunks")
                break

            total_bytes_received += len(data)
            total_chunks_received += 1

            # Log first chunk info
            if total_chunks_received == 1:
                print(f"[WHISPER DEBUG] First stdin chunk received: {len(data)} bytes", file=sys.stderr, flush=True)
                output_status(f"First audio chunk received: {len(data)} bytes",
                            sample_rate=transcriber.sample_rate,
                            channels=transcriber.channels,
                            bit_depth=transcriber.bit_depth)

            # Log every 20th chunk for more visibility
            if total_chunks_received % 20 == 0:
                buffer_duration = transcriber.get_buffer_duration()
                chunk_threshold = transcriber.chunk_bytes
                print(f"[WHISPER DEBUG] Chunk #{total_chunks_received}: buffer={len(transcriber.audio_buffer)/1024:.1f}KB ({buffer_duration:.2f}s), need={chunk_threshold/1024:.1f}KB ({transcriber.chunk_duration}s)", file=sys.stderr, flush=True)

            transcriber.add_audio(data)

            # Report buffer status periodically (every STATUS_INTERVAL seconds)
            current_time = time.time()
            if current_time - last_status_time >= STATUS_INTERVAL:
                buffer_duration = transcriber.get_buffer_duration()
                output_status(f"Audio stats: {total_bytes_received / 1024:.1f} KB received, {segments_produced} segments produced",
                            buffered_seconds=buffer_duration,
                            total_chunks=total_chunks_received)
                last_status_time = current_time

            # Report buffer status when approaching threshold
            buffer_duration = transcriber.get_buffer_duration()
            if buffer_duration >= transcriber.chunk_duration * 0.9:
                output_status("Processing buffered audio...", buffered_seconds=buffer_duration)

            # Process if we have enough data
            segments = transcriber.process_buffer()
            for seg in segments:
                segments_produced += 1
                output_segment(
                    seg["text"],
                    seg["start"],
                    seg["end"],
                    seg.get("confidence"),
                    seg.get("words"),
                    seg.get("speaker")  # Include speaker label from diarization
                )

        # Process remaining audio
        output_status("Processing remaining audio...")
        segments = transcriber.process_remaining()
        for seg in segments:
            segments_produced += 1
            output_segment(
                seg["text"],
                seg["start"],
                seg["end"],
                seg.get("confidence"),
                seg.get("words"),
                seg.get("speaker")  # Include speaker label from diarization
            )

        output_json({
            "type": "complete",
            "total_seconds": transcriber.total_processed_samples / transcriber.sample_rate,
            "total_bytes_received": total_bytes_received,
            "total_chunks": total_chunks_received,
            "segments_produced": segments_produced
        })

    except KeyboardInterrupt:
        output_status("Interrupted by user")
    except Exception as e:
        output_error(f"Error reading audio: {str(e)}. Received {total_bytes_received / 1024:.1f} KB in {total_chunks_received} chunks.", "READ_ERROR")


def read_pipe_audio(transcriber: StreamingTranscriber, pipe_path: str) -> None:
    """Read audio from a named pipe."""
    if not os.path.exists(pipe_path):
        try:
            os.mkfifo(pipe_path)
            output_status(f"Created named pipe: {pipe_path}")
        except Exception as e:
            output_error(f"Failed to create pipe: {str(e)}", "PIPE_ERROR")
            return

    output_status(f"Waiting for audio data on pipe: {pipe_path}")

    try:
        with open(pipe_path, 'rb') as pipe:
            while transcriber.is_running:
                data = pipe.read(4096)
                if not data:
                    break

                transcriber.add_audio(data)

                segments = transcriber.process_buffer()
                for seg in segments:
                    output_segment(
                        seg["text"],
                        seg["start"],
                        seg["end"],
                        seg.get("confidence"),
                        seg.get("words"),
                        seg.get("speaker")  # Include speaker label from diarization
                    )

        # Process remaining
        segments = transcriber.process_remaining()
        for seg in segments:
            output_segment(
                seg["text"],
                seg["start"],
                seg["end"],
                seg.get("confidence"),
                seg.get("words"),
                seg.get("speaker")  # Include speaker label from diarization
            )

        output_json({"type": "complete", "total_seconds": transcriber.total_processed_samples / transcriber.sample_rate})

    except Exception as e:
        output_error(f"Error reading from pipe: {str(e)}", "PIPE_READ_ERROR")


def main():
    parser = argparse.ArgumentParser(
        description="Streaming audio transcription for live recordings"
    )

    parser.add_argument(
        "--model", "-m",
        default="base",
        choices=["tiny", "base", "small", "medium", "large-v2", "large-v3"],
        help="Model size (default: base for lower latency)"
    )

    parser.add_argument(
        "--language", "-l",
        default="en",
        help="Language code (default: en)"
    )

    parser.add_argument(
        "--sample-rate", "-r",
        type=int,
        default=16000,
        help="Audio sample rate in Hz (default: 16000)"
    )

    parser.add_argument(
        "--channels", "-c",
        type=int,
        default=1,
        choices=[1, 2],
        help="Number of audio channels (default: 1)"
    )

    parser.add_argument(
        "--bit-depth", "-b",
        type=int,
        default=16,
        choices=[16, 32],
        help="Bits per sample (default: 16)"
    )

    parser.add_argument(
        "--chunk-duration",
        type=float,
        default=5.0,
        help="Duration in seconds to buffer before transcribing (default: 5.0)"
    )

    parser.add_argument(
        "--pipe", "-p",
        help="Path to named pipe to read audio from (instead of stdin)"
    )

    parser.add_argument(
        "--device", "-d",
        choices=["cuda", "cpu"],
        help="Device to use (default: auto-detect)"
    )

    parser.add_argument(
        "--confidence-threshold",
        type=float,
        default=0.3,
        help="Minimum confidence score to accept a segment (0.0-1.0, default: 0.3)"
    )

    parser.add_argument(
        "--no-vad",
        action="store_true",
        help="Disable Voice Activity Detection (VAD)"
    )

    parser.add_argument(
        "--permissive-vad",
        action="store_true",
        help="Use permissive VAD settings (lower threshold) for system audio transcription. "
             "This is useful when transcribing audio from virtual cables (BlackHole, etc.) "
             "where the audio characteristics differ from live microphone speech."
    )

    # Speaker diarization arguments
    parser.add_argument(
        "--diarization",
        action="store_true",
        help="Enable real-time speaker diarization to identify and label different speakers"
    )

    parser.add_argument(
        "--diarization-threshold",
        type=float,
        default=0.5,
        help="Speaker similarity threshold for diarization (0.0-1.0, default: 0.5). "
             "Lower values = more speakers detected."
    )

    parser.add_argument(
        "--max-speakers",
        type=int,
        default=10,
        help="Maximum number of speakers to track (default: 10)"
    )

    parser.add_argument(
        "--initial-time-offset",
        type=float,
        default=0.0,
        help="Initial time offset in seconds for buffered audio synchronization (default: 0.0). "
             "This is used to correctly timestamp audio that was buffered while the model was loading."
    )

    args = parser.parse_args()

    # Check if we have any backend available
    if not WHISPERX_AVAILABLE and not FASTER_WHISPER_AVAILABLE:
        error_msg = "No transcription backend available. Install whisperx or faster-whisper."
        if _IMPORT_ERROR_MESSAGE:
            error_msg += f" Details: {_IMPORT_ERROR_MESSAGE}"
        output_error(error_msg, "NO_BACKEND")
        sys.exit(1)

    # Initialize transcriber with VAD, confidence filtering, and optional diarization
    # Pass initial_time_offset to correctly handle buffered audio synchronization
    # This fixes the 35-second audio repetition bug
    transcriber = StreamingTranscriber(
        model_size=args.model,
        language=args.language,
        sample_rate=args.sample_rate,
        channels=args.channels,
        bit_depth=args.bit_depth,
        chunk_duration=args.chunk_duration,
        device=args.device,
        confidence_threshold=args.confidence_threshold,
        use_vad=not args.no_vad,  # VAD is enabled by default
        permissive_vad=args.permissive_vad,  # Lower VAD threshold for system audio
        enable_diarization=args.diarization,  # Enable real-time speaker identification
        diarization_similarity_threshold=args.diarization_threshold,
        max_speakers=args.max_speakers,
        initial_time_offset=args.initial_time_offset  # For buffered audio timestamp sync
    )

    # Load model
    if not transcriber.load_model():
        sys.exit(1)

    # Determine resampling method for logging
    if TORCHAUDIO_RESAMPLE_AVAILABLE:
        resample_method = "torchaudio"
    elif LIBROSA_AVAILABLE:
        resample_method = "librosa"
    elif SCIPY_AVAILABLE:
        resample_method = "scipy"
    else:
        resample_method = "decimation (low quality)"

    # Log resampling info if sample rate differs from WhisperX expected rate
    needs_resample = args.sample_rate != WHISPERX_SAMPLE_RATE
    if needs_resample:
        output_status(f"Audio resampling enabled: {args.sample_rate}Hz -> {WHISPERX_SAMPLE_RATE}Hz (using {resample_method})")

    output_json({
        "type": "ready",
        "backend": transcriber.backend,
        "model": args.model,
        "device": transcriber.device,
        "sample_rate": args.sample_rate,
        "target_sample_rate": WHISPERX_SAMPLE_RATE,
        "needs_resample": needs_resample,
        "resample_method": resample_method if needs_resample else None,
        "chunk_duration": args.chunk_duration,
        "vad_enabled": not args.no_vad,
        "silero_vad_available": SILERO_VAD_AVAILABLE,
        "permissive_vad": args.permissive_vad,  # Lower threshold for system audio
        "confidence_threshold": args.confidence_threshold,
        "diarization_enabled": transcriber.enable_diarization,
        "diarization_threshold": args.diarization_threshold if args.diarization else None,
        "max_speakers": args.max_speakers if args.diarization else None
    })

    # Debug: Log when we're about to start reading audio
    print(f"[WHISPER DEBUG] Model ready, starting audio processing loop", file=sys.stderr, flush=True)
    print(f"[WHISPER DEBUG] Expected chunk_bytes: {transcriber.chunk_bytes} ({transcriber.chunk_bytes/1024:.1f} KB)", file=sys.stderr, flush=True)
    print(f"[WHISPER DEBUG] At {args.sample_rate}Hz, {args.chunk_duration}s chunks = {args.sample_rate * args.chunk_duration * 2 / 1024:.1f} KB", file=sys.stderr, flush=True)

    # Start processing
    if args.pipe:
        read_pipe_audio(transcriber, args.pipe)
    else:
        read_stdin_audio(transcriber)


if __name__ == "__main__":
    main()
