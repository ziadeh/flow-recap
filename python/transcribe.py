#!/usr/bin/env python3
"""
transcribe.py - Audio transcription module using WhisperX or faster-whisper

This module provides functionality to transcribe audio files using WhisperX
(preferred) or faster-whisper as a fallback. Both systems provide fast
automatic speech recognition with word-level timestamps.

Features:
    - Support for 16kHz audio input (auto-resampled internally)
    - Timestamped segments with confidence scores
    - Word-level alignment and timestamps
    - Support for large-v2 model (default)
    - Multiple output formats (JSON, text, SRT)

Usage:
    python transcribe.py <audio_file> [--model <model_size>] [--language <lang>] [--output <output_file>]

Example:
    python transcribe.py meeting.wav --model large-v2 --language en --output transcript.json
"""

import argparse
import json
import os
import sys
import warnings
from typing import Optional, Dict, Any, List
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

# PyTorch 2.6+ changed the default weights_only=True for torch.load()
# This causes issues with pyannote.audio, whisperx, and other libraries that use omegaconf
# We need to allowlist the necessary classes before importing torch
try:
    import typing
    import collections
    import torch
    import torch.serialization
    # Allowlist omegaconf classes and other types used by pyannote.audio and whisperx models
    from omegaconf import DictConfig, ListConfig
    from omegaconf.base import ContainerMetadata
    # Add built-in types and common classes needed for model deserialization
    safe_globals = [DictConfig, ListConfig, ContainerMetadata, typing.Any, list, dict, tuple, set, collections.defaultdict]
    # Try to add pyannote-specific classes if available
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
    # If this fails, continue anyway - the fix may not be needed for older PyTorch versions
    pass

# Attempt to import whisperx - will be available after pip install
WHISPERX_AVAILABLE = False
FASTER_WHISPER_AVAILABLE = False

try:
    import whisperx
    import torch
    WHISPERX_AVAILABLE = True
except ImportError:
    pass

# Try faster-whisper as a fallback
if not WHISPERX_AVAILABLE:
    try:
        from faster_whisper import WhisperModel
        import torch
        FASTER_WHISPER_AVAILABLE = True
    except ImportError:
        pass

if not WHISPERX_AVAILABLE and not FASTER_WHISPER_AVAILABLE:
    print("Warning: Neither whisperx nor faster-whisper installed. Run 'pip install -r requirements.txt' first.", file=sys.stderr)


def is_likely_hallucination(text: str, confidence: Optional[float] = None) -> bool:
    """
    Detect if transcribed text is likely a hallucination.

    Whisper hallucinations often have these characteristics:
    - Very repetitive patterns
    - Common hallucination phrases
    - Very short or empty text
    - Low confidence scores

    Args:
        text: The transcribed text
        confidence: Optional confidence score (0.0-1.0)

    Returns:
        True if the text is likely a hallucination
    """
    if not text or not text.strip():
        return True

    text_lower = text.lower().strip()

    # Check for minimum confidence threshold
    if confidence is not None and confidence < 0.4:
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


class Transcriber:
    """
    A class to handle audio transcription using WhisperX or faster-whisper.

    This transcriber is optimized for:
    - 16kHz audio input (auto-resampled internally)
    - Timestamped segments with confidence scores
    - Word-level alignment and timestamps
    - Large-v2 model support (default)

    Attributes:
        model_size (str): The model size to use (tiny, base, small, medium, large-v2, large-v3)
        device (str): The device to run inference on (cuda or cpu)
        compute_type (str): The compute type for inference (float16, float32, int8)
        language (str): The language code for transcription (e.g., 'en', 'es', 'fr')
        backend (str): The transcription backend ('whisperx' or 'faster-whisper')
    """

    # Available model sizes
    MODEL_SIZES = ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3']

    # Supported languages (subset of most common)
    SUPPORTED_LANGUAGES = {
        'en': 'English',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'it': 'Italian',
        'pt': 'Portuguese',
        'nl': 'Dutch',
        'pl': 'Polish',
        'ru': 'Russian',
        'ja': 'Japanese',
        'zh': 'Chinese',
        'ko': 'Korean',
        'ar': 'Arabic',
        'hi': 'Hindi',
    }

    # Expected sample rate for optimal transcription
    EXPECTED_SAMPLE_RATE = 16000

    def __init__(
        self,
        model_size: str = "large-v2",
        device: Optional[str] = None,
        compute_type: str = "float16",
        language: str = "en"
    ):
        """
        Initialize the Transcriber.

        Args:
            model_size: Model size (default: large-v2)
            device: Device for inference, auto-detected if None
            compute_type: Compute precision (float16, float32, int8)
            language: Language code for transcription
        """
        if not WHISPERX_AVAILABLE and not FASTER_WHISPER_AVAILABLE:
            raise RuntimeError(
                "Neither WhisperX nor faster-whisper is installed. "
                "Please run 'pip install -r requirements.txt'"
            )

        if model_size not in self.MODEL_SIZES:
            raise ValueError(f"Invalid model size. Choose from: {self.MODEL_SIZES}")

        self.model_size = model_size
        self.language = language
        self.compute_type = compute_type

        # Determine which backend to use
        self.backend = "whisperx" if WHISPERX_AVAILABLE else "faster-whisper"

        # Auto-detect device
        if device is None:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device

        # Adjust compute type for CPU
        if self.device == "cpu" and compute_type == "float16":
            self.compute_type = "float32"

        self.model = None
        self.align_model = None
        self.align_metadata = None

    def load_model(self) -> None:
        """Load the transcription model into memory."""
        print(f"Loading {self.backend} model '{self.model_size}' on {self.device}...")

        if self.backend == "whisperx":
            self.model = whisperx.load_model(
                self.model_size,
                self.device,
                compute_type=self.compute_type,
                language=self.language
            )
        else:
            # faster-whisper backend
            self.model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type
            )

        print(f"Model loaded successfully (backend: {self.backend}).")

    def load_alignment_model(self) -> None:
        """Load the alignment model for word-level timestamps (WhisperX only)."""
        if self.backend != "whisperx":
            print("Word alignment is only available with WhisperX backend.")
            return

        print(f"Loading alignment model for language '{self.language}'...")
        self.align_model, self.align_metadata = whisperx.load_align_model(
            language_code=self.language,
            device=self.device
        )
        print("Alignment model loaded successfully.")

    @staticmethod
    def calculate_segment_confidence(words: Optional[List[Dict]]) -> Optional[float]:
        """
        Calculate segment-level confidence from word-level scores.

        Args:
            words: List of word dictionaries with 'score' field

        Returns:
            Average confidence score (0.0-1.0) or None if no scores available
        """
        if not words:
            return None

        scores = [w.get('score') for w in words if w.get('score') is not None]
        if not scores:
            return None

        return sum(scores) / len(scores)

    def transcribe(
        self,
        audio_path: str,
        batch_size: int = 16,
        align_words: bool = True
    ) -> Dict[str, Any]:
        """
        Transcribe an audio file with timestamped segments and confidence scores.

        The audio is expected to be 16kHz mono for optimal results, but will be
        automatically resampled internally if needed.

        Args:
            audio_path: Path to the audio file (16kHz recommended)
            batch_size: Batch size for inference (reduce if OOM)
            align_words: Whether to perform word-level alignment (WhisperX only)

        Returns:
            Dictionary containing:
                - segments: List of transcribed segments with timestamps and confidence
                - metadata: Information about the transcription configuration
        """
        if self.model is None:
            self.load_model()

        # Validate audio file
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        print(f"Loading audio from {audio_path}...")

        if self.backend == "whisperx":
            result = self._transcribe_whisperx(str(audio_path), batch_size, align_words)
        else:
            result = self._transcribe_faster_whisper(str(audio_path), batch_size)
            align_words = False  # faster-whisper provides word timestamps natively

        # Add segment-level confidence scores and filter hallucinations
        filtered_count = 0
        if "segments" in result:
            filtered_segments = []
            for segment in result["segments"]:
                if "confidence" not in segment:
                    segment["confidence"] = self.calculate_segment_confidence(
                        segment.get("words", [])
                    )

                # Filter out likely hallucinations
                text = segment.get("text", "").strip()
                confidence = segment.get("confidence")
                if is_likely_hallucination(text, confidence):
                    filtered_count += 1
                    print(f"Filtered hallucination: '{text[:50]}...' (confidence: {confidence})")
                    continue

                filtered_segments.append(segment)

            result["segments"] = filtered_segments

            if filtered_count > 0:
                print(f"Filtered {filtered_count} likely hallucination segment(s)")

        # Add metadata to result
        result["metadata"] = {
            "audio_file": str(audio_path),
            "model_size": self.model_size,
            "language": self.language,
            "device": self.device,
            "word_aligned": align_words,
            "backend": self.backend,
            "expected_sample_rate": self.EXPECTED_SAMPLE_RATE,
            "hallucinations_filtered": filtered_count
        }

        return result

    def _transcribe_whisperx(
        self,
        audio_path: str,
        batch_size: int,
        align_words: bool
    ) -> Dict[str, Any]:
        """Transcribe using WhisperX backend."""
        # WhisperX handles resampling internally via load_audio
        audio = whisperx.load_audio(audio_path)

        print("Transcribing audio with WhisperX...")
        result = self.model.transcribe(audio, batch_size=batch_size)

        # Perform word-level alignment if requested
        if align_words:
            if self.align_model is None:
                self.load_alignment_model()

            print("Aligning words...")
            result = whisperx.align(
                result["segments"],
                self.align_model,
                self.align_metadata,
                audio,
                self.device,
                return_char_alignments=False
            )

        return result

    def _transcribe_faster_whisper(
        self,
        audio_path: str,
        batch_size: int
    ) -> Dict[str, Any]:
        """Transcribe using faster-whisper backend."""
        print("Transcribing audio with faster-whisper...")

        # faster-whisper returns an iterator of segments
        segments_iter, info = self.model.transcribe(
            audio_path,
            language=self.language,
            beam_size=5,
            word_timestamps=True,
            vad_filter=True
        )

        segments = []
        for segment in segments_iter:
            seg_dict = {
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
            }

            # Add word-level data if available
            if segment.words:
                seg_dict["words"] = [
                    {
                        "start": word.start,
                        "end": word.end,
                        "word": word.word,
                        "score": word.probability
                    }
                    for word in segment.words
                ]
                # Calculate segment confidence from word probabilities
                seg_dict["confidence"] = self.calculate_segment_confidence(seg_dict["words"])

            segments.append(seg_dict)

        return {"segments": segments}

    def transcribe_to_text(self, audio_path: str, **kwargs) -> str:
        """
        Transcribe audio and return plain text.

        Args:
            audio_path: Path to the audio file
            **kwargs: Additional arguments passed to transcribe()

        Returns:
            Plain text transcription
        """
        result = self.transcribe(audio_path, **kwargs)
        segments = result.get("segments", [])
        return " ".join(seg.get("text", "").strip() for seg in segments)

    def transcribe_to_srt(self, audio_path: str, **kwargs) -> str:
        """
        Transcribe audio and return SRT format subtitles.

        Args:
            audio_path: Path to the audio file
            **kwargs: Additional arguments passed to transcribe()

        Returns:
            SRT formatted string
        """
        result = self.transcribe(audio_path, **kwargs)
        segments = result.get("segments", [])

        srt_lines = []
        for i, segment in enumerate(segments, 1):
            start = self._format_timestamp_srt(segment.get("start", 0))
            end = self._format_timestamp_srt(segment.get("end", 0))
            text = segment.get("text", "").strip()

            srt_lines.append(f"{i}")
            srt_lines.append(f"{start} --> {end}")
            srt_lines.append(text)
            srt_lines.append("")

        return "\n".join(srt_lines)

    @staticmethod
    def _format_timestamp_srt(seconds: float) -> str:
        """Convert seconds to SRT timestamp format (HH:MM:SS,mmm)."""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds - int(seconds)) * 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def format_segments(segments: List[Dict]) -> str:
    """
    Format transcription segments for display.

    Args:
        segments: List of segment dictionaries

    Returns:
        Formatted string representation
    """
    lines = []
    for seg in segments:
        start = seg.get("start", 0)
        end = seg.get("end", 0)
        text = seg.get("text", "").strip()
        lines.append(f"[{start:.2f}s - {end:.2f}s] {text}")
    return "\n".join(lines)


def main():
    """Main entry point for CLI usage."""
    parser = argparse.ArgumentParser(
        description="Transcribe audio files using WhisperX",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python transcribe.py meeting.wav
  python transcribe.py meeting.wav --model large-v2 --language en
  python transcribe.py meeting.wav --output transcript.json --format json
  python transcribe.py meeting.wav --output subtitles.srt --format srt
        """
    )

    parser.add_argument(
        "audio_file",
        help="Path to the audio file to transcribe"
    )

    parser.add_argument(
        "--model", "-m",
        default="large-v2",
        choices=Transcriber.MODEL_SIZES,
        help="WhisperX model size (default: large-v2)"
    )

    parser.add_argument(
        "--language", "-l",
        default="en",
        help="Language code (default: en)"
    )

    parser.add_argument(
        "--output", "-o",
        help="Output file path (default: stdout)"
    )

    parser.add_argument(
        "--format", "-f",
        default="json",
        choices=["json", "text", "srt"],
        help="Output format (default: json)"
    )

    parser.add_argument(
        "--batch-size", "-b",
        type=int,
        default=16,
        help="Batch size for inference (default: 16, reduce if OOM)"
    )

    parser.add_argument(
        "--no-align",
        action="store_true",
        help="Skip word-level alignment"
    )

    parser.add_argument(
        "--device", "-d",
        choices=["cuda", "cpu"],
        help="Device to use (default: auto-detect)"
    )

    args = parser.parse_args()

    if not WHISPERX_AVAILABLE and not FASTER_WHISPER_AVAILABLE:
        print("Error: Neither WhisperX nor faster-whisper is installed.", file=sys.stderr)
        print("Please run: pip install -r requirements.txt", file=sys.stderr)
        sys.exit(1)

    try:
        # Initialize transcriber
        transcriber = Transcriber(
            model_size=args.model,
            device=args.device,
            language=args.language
        )

        # Perform transcription based on format
        if args.format == "text":
            output = transcriber.transcribe_to_text(
                args.audio_file,
                batch_size=args.batch_size,
                align_words=not args.no_align
            )
        elif args.format == "srt":
            output = transcriber.transcribe_to_srt(
                args.audio_file,
                batch_size=args.batch_size,
                align_words=not args.no_align
            )
        else:  # json
            result = transcriber.transcribe(
                args.audio_file,
                batch_size=args.batch_size,
                align_words=not args.no_align
            )
            output = json.dumps(result, indent=2, ensure_ascii=False)

        # Write output
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output)
            print(f"Transcription saved to: {args.output}")
        else:
            print(output)

    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error during transcription: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
