#!/usr/bin/env python3
"""
diarize.py - Speaker diarization module using pyannote.audio

This module provides functionality to perform speaker diarization on audio files,
identifying who speaks when in a conversation.

AUDIO PREPROCESSING:
    This module uses diarization-optimized audio preprocessing to maximize accuracy.
    The preprocessing pipeline MINIMIZES destructive processing to preserve speaker
    embeddings:
    - Format conversion to 16kHz mono PCM
    - DC offset removal (safe, doesn't affect speaker characteristics)
    - Gentle peak limiting to prevent clipping

    IMPORTANT: Aggressive noise suppression, echo cancellation, and loudness
    normalization are DISABLED by default as they DESTROY speaker embeddings
    and REDUCE diarization accuracy.

Usage:
    python diarize.py <audio_file> [--num-speakers <n>] [--output <output_file>]

Example:
    python diarize.py meeting.wav --num-speakers 3 --output diarization.json
    python diarize.py meeting.wav --preprocess --quality-check  # With preprocessing
    python diarize.py meeting.wav --skip-preprocess  # Skip preprocessing

Note:
    You need a Hugging Face token with access to pyannote models.
    Get access at: https://huggingface.co/pyannote/speaker-diarization-3.1
    Set your token: export HF_TOKEN=your_token_here
"""

import argparse
import json
import os
import sys
import warnings
from typing import Optional, Dict, Any, List, Tuple
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

# Attempt to import pyannote - will be available after pip install
try:
    from pyannote.audio import Pipeline
    from pyannote.audio.pipelines.utils.hook import ProgressHook
    import torch
    PYANNOTE_AVAILABLE = True
except ImportError:
    PYANNOTE_AVAILABLE = False
    print("Warning: pyannote.audio not installed. Run 'pip install -r requirements.txt' first.")

# Import diarization-optimized audio preprocessing
try:
    from diarization_audio_preprocessor import (
        DiarizationAudioPreprocessor,
        AudioQualityReport,
        DiarizationPreprocessingConfig
    )
    PREPROCESSOR_AVAILABLE = True
except ImportError:
    PREPROCESSOR_AVAILABLE = False
    # Preprocessing module not available - will proceed without preprocessing


class Diarizer:
    """
    A class to handle speaker diarization using pyannote.audio.

    Attributes:
        model_name (str): The pyannote model to use
        device (str): The device to run inference on (cuda or cpu)
        hf_token (str): Hugging Face access token
        enable_preprocessing (bool): Whether to apply diarization-optimized preprocessing
        quality_check (bool): Whether to validate audio quality before diarization
        clustering_threshold (float): Threshold for speaker clustering (0.0-2.0)
    """

    # Default pyannote model
    DEFAULT_MODEL = "pyannote/speaker-diarization-3.1"

    # FIXED: Default clustering threshold - lower than pyannote's default (~0.7) for better separation
    # Changed from 0.4 to 0.35 to increase sensitivity and detect more distinct speakers
    # A value of 0.35 provides better speaker separation for similar-sounding voices
    # (especially useful for compressed audio from videos or calls)
    DEFAULT_CLUSTERING_THRESHOLD = 0.35

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        device: Optional[str] = None,
        hf_token: Optional[str] = None,
        enable_preprocessing: bool = True,
        quality_check: bool = True,
        clustering_threshold: Optional[float] = None
    ):
        """
        Initialize the Diarizer.

        Args:
            model_name: pyannote model name (default: speaker-diarization-3.1)
            device: Device for inference, auto-detected if None
            hf_token: Hugging Face token (or set HF_TOKEN env var)
            enable_preprocessing: Apply diarization-optimized preprocessing (default: True)
            quality_check: Validate audio quality and warn about issues (default: True)
            clustering_threshold: Threshold for speaker clustering (0.0-2.0).
                                 Lower values = more speakers detected (more sensitive).
                                 Higher values = fewer speakers (more tolerant).
                                 Default: 0.5 (more sensitive than pyannote's default ~0.7)
        """
        if not PYANNOTE_AVAILABLE:
            raise RuntimeError("pyannote.audio is not installed. Please run 'pip install -r requirements.txt'")

        self.model_name = model_name
        self.enable_preprocessing = enable_preprocessing and PREPROCESSOR_AVAILABLE
        self.quality_check = quality_check
        self.clustering_threshold = clustering_threshold if clustering_threshold is not None else self.DEFAULT_CLUSTERING_THRESHOLD

        # Get HF token from parameter or environment
        self.hf_token = hf_token or os.environ.get("HF_TOKEN")
        if not self.hf_token:
            raise ValueError(
                "Hugging Face token required. Set HF_TOKEN environment variable "
                "or pass hf_token parameter. Get access at: "
                "https://huggingface.co/pyannote/speaker-diarization-3.1"
            )

        # Auto-detect device
        if device is None:
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(device)

        self.pipeline = None

        # Initialize audio preprocessor if available
        self.preprocessor = None
        if self.enable_preprocessing:
            try:
                self.preprocessor = DiarizationAudioPreprocessor()
                print("[Diarization] Audio preprocessing enabled (minimal processing mode)")
            except Exception as e:
                print(f"[Diarization] Warning: Could not initialize preprocessor: {e}")
                self.preprocessor = None

        print(f"[Diarization] Clustering threshold: {self.clustering_threshold}")

    def load_pipeline(self) -> None:
        """Load the pyannote diarization pipeline and apply clustering threshold."""
        print(f"Loading pyannote pipeline '{self.model_name}' on {self.device}...")
        self.pipeline = Pipeline.from_pretrained(
            self.model_name,
            use_auth_token=self.hf_token
        )
        self.pipeline = self.pipeline.to(self.device)

        # Apply clustering threshold to improve speaker separation
        # Lower threshold = more sensitive to speaker differences = more speakers detected
        if self.clustering_threshold is not None:
            try:
                # Get current parameters
                params = self.pipeline.parameters(instantiated=True)
                print(f"[Diarization] Original pipeline parameters: {dict(params)}")

                # Build new parameters by merging with existing ones
                # Only update clustering threshold to preserve other optimized parameters
                new_params = {}

                # Copy segmentation parameters if they exist
                if "segmentation" in params or hasattr(params, 'get'):
                    try:
                        for key, value in dict(params).items():
                            if key.startswith("segmentation"):
                                new_params[key] = value
                    except Exception:
                        pass

                # Set the new clustering threshold
                new_params["clustering"] = {
                    "threshold": self.clustering_threshold
                }

                # Instantiate returns a new pipeline with the parameters applied
                self.pipeline = self.pipeline.instantiate(new_params)
                print(f"[Diarization] Applied clustering threshold: {self.clustering_threshold}")

                # Verify the change
                updated_params = self.pipeline.parameters(instantiated=True)
                print(f"[Diarization] Updated pipeline parameters: {dict(updated_params)}")

            except Exception as e:
                print(f"[Diarization] Warning: Could not set clustering threshold: {e}")
                print("[Diarization] Proceeding with default pipeline parameters...")

        print("Pipeline loaded successfully.")

    def diarize(
        self,
        audio_path: str,
        num_speakers: Optional[int] = None,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None,
        show_progress: bool = True
    ) -> Dict[str, Any]:
        """
        Perform speaker diarization on an audio file.

        AUDIO PREPROCESSING:
            If preprocessing is enabled (default), the audio is processed with
            MINIMAL destructive effects to preserve speaker embeddings:
            - Format conversion to 16kHz mono PCM
            - DC offset removal
            - Gentle peak limiting

            Aggressive processing (noise suppression, echo cancellation,
            loudness normalization) is DISABLED to preserve speaker characteristics.

        Args:
            audio_path: Path to the audio file
            num_speakers: Exact number of speakers (if known)
            min_speakers: Minimum number of speakers
            max_speakers: Maximum number of speakers
            show_progress: Whether to show progress bar

        Returns:
            Dictionary containing diarization results with speaker segments
        """
        if self.pipeline is None:
            self.load_pipeline()

        # Validate audio file
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        # Apply diarization-optimized preprocessing
        processed_audio_path = str(audio_path)
        quality_report = None

        if self.preprocessor is not None:
            print("[Diarization] Preprocessing audio for optimal diarization...")
            try:
                processed_audio_path, quality_report = self.preprocessor.prepare_for_diarization(
                    str(audio_path)
                )
                print(f"[Diarization] Preprocessed audio saved to: {processed_audio_path}")

                # Log quality warnings
                if quality_report and quality_report.has_warnings:
                    print(f"[Diarization] Audio quality: {quality_report.overall_quality.value}")
                    for warning in quality_report.warnings:
                        icon = "!" if warning.severity == "error" else "⚠" if warning.severity == "warning" else "ℹ"
                        print(f"[Diarization] {icon} {warning.message}")
                        if warning.recommendation:
                            print(f"[Diarization]   → {warning.recommendation}")

            except Exception as e:
                print(f"[Diarization] Warning: Preprocessing failed: {e}")
                print("[Diarization] Proceeding with original audio file...")
                processed_audio_path = str(audio_path)

        print(f"Diarizing audio from {processed_audio_path}...")

        # Prepare diarization parameters
        diarization_params = {}
        if num_speakers is not None:
            diarization_params["num_speakers"] = num_speakers
        if min_speakers is not None:
            diarization_params["min_speakers"] = min_speakers
        if max_speakers is not None:
            diarization_params["max_speakers"] = max_speakers

        # Run diarization with optional progress hook
        if show_progress:
            with ProgressHook() as hook:
                diarization = self.pipeline(
                    processed_audio_path,
                    hook=hook,
                    **diarization_params
                )
        else:
            diarization = self.pipeline(processed_audio_path, **diarization_params)

        # Convert to structured format
        segments = self._convert_to_segments(diarization)

        # Get unique speakers
        speakers = list(set(seg["speaker"] for seg in segments))

        result = {
            "segments": segments,
            "speakers": speakers,
            "num_speakers": len(speakers),
            "metadata": {
                "audio_file": str(audio_path),
                "processed_audio_file": processed_audio_path if processed_audio_path != str(audio_path) else None,
                "model": self.model_name,
                "device": str(self.device),
                "requested_num_speakers": num_speakers,
                "requested_min_speakers": min_speakers,
                "requested_max_speakers": max_speakers,
                "preprocessing_applied": self.preprocessor is not None,
                "clustering_threshold": self.clustering_threshold
            }
        }

        # Include audio quality report if available
        if quality_report:
            result["audio_quality"] = quality_report.to_dict()

        return result

    def _convert_to_segments(self, diarization) -> List[Dict[str, Any]]:
        """
        Convert pyannote diarization output to segment list.

        Args:
            diarization: pyannote Annotation object

        Returns:
            List of segment dictionaries with start, end, speaker
        """
        segments = []
        # Create a mapping from pyannote speaker labels to normalized labels (Speaker_0, Speaker_1, etc.)
        speaker_mapping = {}
        speaker_counter = 0

        for turn, _, speaker in diarization.itertracks(yield_label=True):
            # Normalize speaker label to Speaker_0, Speaker_1, etc.
            if speaker not in speaker_mapping:
                speaker_mapping[speaker] = f"Speaker_{speaker_counter}"
                speaker_counter += 1

            normalized_speaker = speaker_mapping[speaker]
            segments.append({
                "start": turn.start,
                "end": turn.end,
                "duration": turn.end - turn.start,
                "speaker": normalized_speaker,
                "original_speaker": speaker  # Keep original label for debugging
            })
        return segments

    def diarize_with_transcription(
        self,
        audio_path: str,
        transcription_segments: List[Dict],
        **kwargs
    ) -> Dict[str, Any]:
        """
        Combine diarization with transcription segments using improved alignment.

        Args:
            audio_path: Path to the audio file
            transcription_segments: Transcription segments from WhisperX
            **kwargs: Additional arguments for diarize()

        Returns:
            Dictionary with combined segments and speaker information
        """
        diarization_result = self.diarize(audio_path, **kwargs)
        diarization_segments = diarization_result["segments"]

        # Assign speakers to transcription segments using weighted overlap
        combined_segments = []
        for trans_seg in transcription_segments:
            trans_start = trans_seg.get("start", 0)
            trans_end = trans_seg.get("end", 0)

            # Find the best matching speaker using overlap-based matching
            speaker = self._find_best_speaker(diarization_segments, trans_start, trans_end)

            combined_segment = {
                **trans_seg,
                "speaker": speaker
            }
            combined_segments.append(combined_segment)

        return {
            "segments": combined_segments,
            "speakers": diarization_result["speakers"],
            "num_speakers": diarization_result["num_speakers"],
            "speaker_stats": self.get_speaker_stats(diarization_segments),
            "metadata": diarization_result["metadata"]
        }

    def _find_best_speaker(
        self,
        diarization_segments: List[Dict],
        trans_start: float,
        trans_end: float
    ) -> Optional[str]:
        """
        Find the best matching speaker for a transcription segment using overlap-based matching.

        This method uses weighted overlap calculation to find the speaker who was
        talking most during the transcription segment, rather than just checking
        the midpoint.

        Args:
            diarization_segments: List of diarization segments
            trans_start: Start time of transcription segment in seconds
            trans_end: End time of transcription segment in seconds

        Returns:
            Speaker label with best overlap, or None if no overlap found
        """
        speaker_overlaps = {}
        trans_duration = trans_end - trans_start

        if trans_duration <= 0:
            return self._find_speaker_at_time(diarization_segments, trans_start)

        for seg in diarization_segments:
            # Calculate overlap between transcription segment and diarization segment
            overlap_start = max(trans_start, seg["start"])
            overlap_end = min(trans_end, seg["end"])
            overlap = max(0, overlap_end - overlap_start)

            if overlap > 0:
                speaker = seg["speaker"]
                if speaker not in speaker_overlaps:
                    speaker_overlaps[speaker] = 0
                speaker_overlaps[speaker] += overlap

        if not speaker_overlaps:
            # Fallback to midpoint matching if no overlap found
            return self._find_speaker_at_time(diarization_segments, (trans_start + trans_end) / 2)

        # Return the speaker with the most overlap
        return max(speaker_overlaps.items(), key=lambda x: x[1])[0]

    def _find_speaker_at_time(
        self,
        segments: List[Dict],
        time: float
    ) -> Optional[str]:
        """
        Find which speaker is speaking at a given time.

        Args:
            segments: List of diarization segments
            time: Time in seconds

        Returns:
            Speaker label or None if no speaker found
        """
        for seg in segments:
            if seg["start"] <= time <= seg["end"]:
                return seg["speaker"]

        # If no exact match, find the nearest speaker
        if segments:
            nearest = min(segments, key=lambda s: min(abs(s["start"] - time), abs(s["end"] - time)))
            # Only return nearest if within 1 second
            if min(abs(nearest["start"] - time), abs(nearest["end"] - time)) <= 1.0:
                return nearest["speaker"]

        return None

    def get_speaker_stats(self, segments: List[Dict]) -> Dict[str, Dict]:
        """
        Calculate statistics for each speaker.

        Args:
            segments: List of diarization segments

        Returns:
            Dictionary with per-speaker statistics
        """
        stats = {}
        for seg in segments:
            speaker = seg["speaker"]
            duration = seg["duration"]

            if speaker not in stats:
                stats[speaker] = {
                    "total_duration": 0,
                    "num_segments": 0,
                    "segments": []
                }

            stats[speaker]["total_duration"] += duration
            stats[speaker]["num_segments"] += 1
            stats[speaker]["segments"].append({
                "start": seg["start"],
                "end": seg["end"]
            })

        # Calculate percentages
        total_speech = sum(s["total_duration"] for s in stats.values())
        for speaker in stats:
            stats[speaker]["percentage"] = (
                (stats[speaker]["total_duration"] / total_speech * 100)
                if total_speech > 0 else 0
            )

        return stats


def format_diarization(segments: List[Dict]) -> str:
    """
    Format diarization segments for display.

    Args:
        segments: List of segment dictionaries

    Returns:
        Formatted string representation
    """
    lines = []
    for seg in segments:
        start = seg["start"]
        end = seg["end"]
        speaker = seg["speaker"]
        text = seg.get("text", "")

        if text:
            lines.append(f"[{start:.2f}s - {end:.2f}s] {speaker}: {text}")
        else:
            lines.append(f"[{start:.2f}s - {end:.2f}s] {speaker}")

    return "\n".join(lines)


def format_rttm(segments: List[Dict], audio_file: str) -> str:
    """
    Format diarization as RTTM (Rich Transcription Time Marked).

    Args:
        segments: List of segment dictionaries
        audio_file: Audio file name (for RTTM format)

    Returns:
        RTTM formatted string
    """
    lines = []
    file_id = Path(audio_file).stem

    for seg in segments:
        start = seg["start"]
        duration = seg["duration"]
        speaker = seg["speaker"]

        # RTTM format: SPEAKER file 1 start duration <NA> <NA> speaker <NA> <NA>
        lines.append(
            f"SPEAKER {file_id} 1 {start:.3f} {duration:.3f} <NA> <NA> {speaker} <NA> <NA>"
        )

    return "\n".join(lines)


def main():
    """Main entry point for CLI usage."""
    parser = argparse.ArgumentParser(
        description="Perform speaker diarization using pyannote.audio",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python diarize.py meeting.wav
  python diarize.py meeting.wav --num-speakers 3
  python diarize.py meeting.wav --min-speakers 2 --max-speakers 5
  python diarize.py meeting.wav --output diarization.json --format json
  python diarize.py meeting.wav --output diarization.rttm --format rttm

Environment:
  HF_TOKEN: Hugging Face access token (required)
            Get access at: https://huggingface.co/pyannote/speaker-diarization-3.1
        """
    )

    parser.add_argument(
        "audio_file",
        help="Path to the audio file to diarize"
    )

    parser.add_argument(
        "--num-speakers", "-n",
        type=int,
        help="Exact number of speakers (if known)"
    )

    parser.add_argument(
        "--min-speakers",
        type=int,
        help="Minimum number of speakers"
    )

    parser.add_argument(
        "--max-speakers",
        type=int,
        help="Maximum number of speakers"
    )

    parser.add_argument(
        "--output", "-o",
        help="Output file path (default: stdout)"
    )

    parser.add_argument(
        "--format", "-f",
        default="json",
        choices=["json", "text", "rttm"],
        help="Output format (default: json)"
    )

    parser.add_argument(
        "--device", "-d",
        choices=["cuda", "cpu"],
        help="Device to use (default: auto-detect)"
    )

    parser.add_argument(
        "--hf-token",
        help="Hugging Face token (or set HF_TOKEN env var)"
    )

    parser.add_argument(
        "--no-progress",
        action="store_true",
        help="Disable progress bar"
    )

    parser.add_argument(
        "--stats",
        action="store_true",
        help="Include speaker statistics in output"
    )

    # Preprocessing options
    parser.add_argument(
        "--preprocess",
        action="store_true",
        default=True,
        help="Apply diarization-optimized preprocessing (default: enabled)"
    )

    parser.add_argument(
        "--skip-preprocess",
        action="store_true",
        help="Skip audio preprocessing (use raw audio)"
    )

    parser.add_argument(
        "--quality-check",
        action="store_true",
        default=True,
        help="Validate audio quality and warn about issues (default: enabled)"
    )

    parser.add_argument(
        "--no-quality-check",
        action="store_true",
        help="Skip audio quality validation"
    )

    parser.add_argument(
        "--clustering-threshold",
        type=float,
        default=None,
        help="Clustering threshold for speaker separation (0.0-2.0). "
             "Lower values = more speakers detected (more sensitive). "
             "Higher values = fewer speakers (more tolerant). "
             "Default: 0.5 (more sensitive than pyannote's default ~0.7). "
             "Try 0.4-0.5 for better separation of similar voices."
    )

    # Alias for --clustering-threshold (for compatibility with other services)
    parser.add_argument(
        "--similarity-threshold",
        type=float,
        default=None,
        dest="similarity_threshold_alias",
        help="Alias for --clustering-threshold (0.0-1.0 range, will be used directly). "
             "Lower values = more speakers detected."
    )

    args = parser.parse_args()

    # Handle both parameter names - prefer explicit clustering-threshold if both provided
    if args.clustering_threshold is None and args.similarity_threshold_alias is not None:
        args.clustering_threshold = args.similarity_threshold_alias

    if not PYANNOTE_AVAILABLE:
        print("Error: pyannote.audio is not installed.", file=sys.stderr)
        print("Please run: pip install -r requirements.txt", file=sys.stderr)
        sys.exit(1)

    # Determine preprocessing settings
    enable_preprocessing = args.preprocess and not args.skip_preprocess
    quality_check = args.quality_check and not args.no_quality_check

    if not enable_preprocessing:
        print("[Diarization] Preprocessing disabled - using raw audio", file=sys.stderr)
    elif not PREPROCESSOR_AVAILABLE:
        print("[Diarization] Warning: Preprocessing module not available", file=sys.stderr)

    try:
        # Initialize diarizer with clustering threshold for better speaker separation
        diarizer = Diarizer(
            device=args.device,
            hf_token=args.hf_token,
            enable_preprocessing=enable_preprocessing,
            quality_check=quality_check,
            clustering_threshold=args.clustering_threshold
        )

        # Perform diarization
        result = diarizer.diarize(
            args.audio_file,
            num_speakers=args.num_speakers,
            min_speakers=args.min_speakers,
            max_speakers=args.max_speakers,
            show_progress=not args.no_progress
        )

        # Add statistics if requested
        if args.stats:
            result["speaker_stats"] = diarizer.get_speaker_stats(result["segments"])

        # Format output
        if args.format == "text":
            output = format_diarization(result["segments"])
        elif args.format == "rttm":
            output = format_rttm(result["segments"], args.audio_file)
        else:  # json
            output = json.dumps(result, indent=2, ensure_ascii=False)

        # Write output
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output)
            print(f"Diarization saved to: {args.output}")
        else:
            print(output)

    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except ValueError as e:
        print(f"Configuration error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error during diarization: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
