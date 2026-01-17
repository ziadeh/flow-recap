#!/usr/bin/env python3
"""
audio_processor.py - Audio processing utilities using ffmpeg and other tools

This module provides utilities for audio file processing including:
- Format conversion
- Audio extraction from video
- Resampling and channel conversion
- Audio normalization
- Silence detection and removal
- Audio splitting and merging

Usage:
    python audio_processor.py <command> <input_file> [options]

Commands:
    convert    - Convert audio format
    extract    - Extract audio from video
    resample   - Resample audio
    normalize  - Normalize audio levels
    info       - Get audio file information
    split      - Split audio by silence

Example:
    python audio_processor.py convert video.mp4 --output audio.wav --format wav
    python audio_processor.py resample audio.wav --sample-rate 16000
"""

import argparse
import json
import os
import subprocess
import sys
from typing import Optional, Dict, Any, List, Tuple
from pathlib import Path

# Attempt to import ffmpeg-python
try:
    import ffmpeg
    FFMPEG_AVAILABLE = True
except ImportError:
    FFMPEG_AVAILABLE = False
    print("Warning: ffmpeg-python not installed. Run 'pip install -r requirements.txt' first.")

# Attempt to import pydub for additional processing
try:
    from pydub import AudioSegment
    from pydub.silence import detect_silence, detect_nonsilent
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False

# Attempt to import soundfile
try:
    import soundfile as sf
    import numpy as np
    SOUNDFILE_AVAILABLE = True
except ImportError:
    SOUNDFILE_AVAILABLE = False


class AudioProcessor:
    """
    A class to handle various audio processing operations.

    Uses ffmpeg-python for format conversion and pydub/soundfile
    for additional audio manipulation.
    """

    # Supported audio formats
    SUPPORTED_FORMATS = ['wav', 'mp3', 'flac', 'ogg', 'aac', 'm4a', 'opus']

    # Common sample rates
    COMMON_SAMPLE_RATES = [8000, 16000, 22050, 44100, 48000]

    def __init__(self, ffmpeg_path: Optional[str] = None):
        """
        Initialize the AudioProcessor.

        Args:
            ffmpeg_path: Optional path to ffmpeg binary
        """
        self.ffmpeg_path = ffmpeg_path

        # Check if ffmpeg is available
        if not self._check_ffmpeg():
            raise RuntimeError(
                "ffmpeg not found. Please install ffmpeg: "
                "brew install ffmpeg (macOS) or apt-get install ffmpeg (Linux)"
            )

    def _check_ffmpeg(self) -> bool:
        """Check if ffmpeg is available in the system."""
        try:
            cmd = [self.ffmpeg_path or "ffmpeg", "-version"]
            subprocess.run(cmd, capture_output=True, check=True)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            return False

    def get_audio_info(self, audio_path: str) -> Dict[str, Any]:
        """
        Get information about an audio file.

        Args:
            audio_path: Path to the audio file

        Returns:
            Dictionary with audio file metadata
        """
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        try:
            probe = ffmpeg.probe(str(audio_path))
            audio_streams = [s for s in probe["streams"] if s["codec_type"] == "audio"]

            if not audio_streams:
                raise ValueError("No audio stream found in file")

            audio_stream = audio_streams[0]
            format_info = probe.get("format", {})

            return {
                "file_path": str(audio_path),
                "format": format_info.get("format_name"),
                "duration": float(format_info.get("duration", 0)),
                "size_bytes": int(format_info.get("size", 0)),
                "bit_rate": int(format_info.get("bit_rate", 0)),
                "codec": audio_stream.get("codec_name"),
                "sample_rate": int(audio_stream.get("sample_rate", 0)),
                "channels": int(audio_stream.get("channels", 0)),
                "channel_layout": audio_stream.get("channel_layout"),
                "bits_per_sample": audio_stream.get("bits_per_sample")
            }
        except ffmpeg.Error as e:
            raise RuntimeError(f"Failed to probe audio file: {e.stderr.decode() if e.stderr else str(e)}")

    def convert(
        self,
        input_path: str,
        output_path: str,
        output_format: Optional[str] = None,
        sample_rate: Optional[int] = None,
        channels: Optional[int] = None,
        bitrate: Optional[str] = None,
        overwrite: bool = False
    ) -> str:
        """
        Convert audio file to different format.

        Args:
            input_path: Path to input audio file
            output_path: Path for output file
            output_format: Target format (wav, mp3, etc.)
            sample_rate: Target sample rate
            channels: Target number of channels (1=mono, 2=stereo)
            bitrate: Target bitrate (e.g., "128k", "256k")
            overwrite: Whether to overwrite existing output file

        Returns:
            Path to the converted file
        """
        input_path = Path(input_path)
        output_path = Path(output_path)

        if not input_path.exists():
            raise FileNotFoundError(f"Input file not found: {input_path}")

        if output_path.exists() and not overwrite:
            raise FileExistsError(f"Output file already exists: {output_path}")

        # Build ffmpeg command
        stream = ffmpeg.input(str(input_path))

        # Apply transformations
        output_kwargs = {}

        if sample_rate:
            output_kwargs["ar"] = sample_rate

        if channels:
            output_kwargs["ac"] = channels

        if bitrate:
            output_kwargs["audio_bitrate"] = bitrate

        if output_format:
            output_kwargs["format"] = output_format

        # Run conversion
        try:
            stream = ffmpeg.output(stream, str(output_path), **output_kwargs)

            if overwrite:
                stream = ffmpeg.overwrite_output(stream)

            ffmpeg.run(stream, capture_stdout=True, capture_stderr=True)
            print(f"Converted: {input_path} -> {output_path}")
            return str(output_path)

        except ffmpeg.Error as e:
            raise RuntimeError(f"Conversion failed: {e.stderr.decode() if e.stderr else str(e)}")

    def extract_audio(
        self,
        video_path: str,
        output_path: str,
        output_format: str = "wav",
        sample_rate: int = 16000,
        channels: int = 1,
        overwrite: bool = False
    ) -> str:
        """
        Extract audio from video file.

        Args:
            video_path: Path to input video file
            output_path: Path for output audio file
            output_format: Audio format (default: wav)
            sample_rate: Sample rate (default: 16000 for speech)
            channels: Number of channels (default: 1 for mono)
            overwrite: Whether to overwrite existing file

        Returns:
            Path to extracted audio file
        """
        video_path = Path(video_path)

        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        return self.convert(
            str(video_path),
            output_path,
            output_format=output_format,
            sample_rate=sample_rate,
            channels=channels,
            overwrite=overwrite
        )

    def resample(
        self,
        input_path: str,
        output_path: str,
        sample_rate: int = 16000,
        overwrite: bool = False
    ) -> str:
        """
        Resample audio to different sample rate.

        Args:
            input_path: Path to input audio file
            output_path: Path for output file
            sample_rate: Target sample rate (default: 16000)
            overwrite: Whether to overwrite existing file

        Returns:
            Path to resampled audio file
        """
        return self.convert(
            input_path,
            output_path,
            sample_rate=sample_rate,
            overwrite=overwrite
        )

    def to_mono(
        self,
        input_path: str,
        output_path: str,
        overwrite: bool = False
    ) -> str:
        """
        Convert stereo audio to mono.

        Args:
            input_path: Path to input audio file
            output_path: Path for output file
            overwrite: Whether to overwrite existing file

        Returns:
            Path to mono audio file
        """
        return self.convert(
            input_path,
            output_path,
            channels=1,
            overwrite=overwrite
        )

    def normalize(
        self,
        input_path: str,
        output_path: str,
        target_db: float = -20.0,
        overwrite: bool = False
    ) -> str:
        """
        Normalize audio levels.

        Args:
            input_path: Path to input audio file
            output_path: Path for output file
            target_db: Target loudness in dB (default: -20.0)
            overwrite: Whether to overwrite existing file

        Returns:
            Path to normalized audio file
        """
        input_path = Path(input_path)
        output_path = Path(output_path)

        if not input_path.exists():
            raise FileNotFoundError(f"Input file not found: {input_path}")

        if output_path.exists() and not overwrite:
            raise FileExistsError(f"Output file already exists: {output_path}")

        try:
            # Two-pass loudness normalization
            stream = ffmpeg.input(str(input_path))
            stream = ffmpeg.output(
                stream,
                str(output_path),
                af=f"loudnorm=I={target_db}:LRA=11:TP=-1.5"
            )

            if overwrite:
                stream = ffmpeg.overwrite_output(stream)

            ffmpeg.run(stream, capture_stdout=True, capture_stderr=True)
            print(f"Normalized: {input_path} -> {output_path}")
            return str(output_path)

        except ffmpeg.Error as e:
            raise RuntimeError(f"Normalization failed: {e.stderr.decode() if e.stderr else str(e)}")

    def trim(
        self,
        input_path: str,
        output_path: str,
        start_time: float,
        end_time: Optional[float] = None,
        duration: Optional[float] = None,
        overwrite: bool = False
    ) -> str:
        """
        Trim audio to specified time range.

        Args:
            input_path: Path to input audio file
            output_path: Path for output file
            start_time: Start time in seconds
            end_time: End time in seconds (optional)
            duration: Duration in seconds (optional, alternative to end_time)
            overwrite: Whether to overwrite existing file

        Returns:
            Path to trimmed audio file
        """
        input_path = Path(input_path)
        output_path = Path(output_path)

        if not input_path.exists():
            raise FileNotFoundError(f"Input file not found: {input_path}")

        if output_path.exists() and not overwrite:
            raise FileExistsError(f"Output file already exists: {output_path}")

        try:
            input_kwargs = {"ss": start_time}

            if duration is not None:
                input_kwargs["t"] = duration
            elif end_time is not None:
                input_kwargs["t"] = end_time - start_time

            stream = ffmpeg.input(str(input_path), **input_kwargs)
            stream = ffmpeg.output(stream, str(output_path), acodec="copy")

            if overwrite:
                stream = ffmpeg.overwrite_output(stream)

            ffmpeg.run(stream, capture_stdout=True, capture_stderr=True)
            print(f"Trimmed: {input_path} -> {output_path}")
            return str(output_path)

        except ffmpeg.Error as e:
            raise RuntimeError(f"Trimming failed: {e.stderr.decode() if e.stderr else str(e)}")

    def merge(
        self,
        input_paths: List[str],
        output_path: str,
        overwrite: bool = False
    ) -> str:
        """
        Merge multiple audio files into one.

        Args:
            input_paths: List of input audio file paths
            output_path: Path for output file
            overwrite: Whether to overwrite existing file

        Returns:
            Path to merged audio file
        """
        output_path = Path(output_path)

        if output_path.exists() and not overwrite:
            raise FileExistsError(f"Output file already exists: {output_path}")

        # Verify all inputs exist
        for path in input_paths:
            if not Path(path).exists():
                raise FileNotFoundError(f"Input file not found: {path}")

        try:
            # Create input streams
            streams = [ffmpeg.input(str(p)) for p in input_paths]

            # Concatenate
            joined = ffmpeg.concat(*streams, a=1, v=0)
            stream = ffmpeg.output(joined, str(output_path))

            if overwrite:
                stream = ffmpeg.overwrite_output(stream)

            ffmpeg.run(stream, capture_stdout=True, capture_stderr=True)
            print(f"Merged {len(input_paths)} files -> {output_path}")
            return str(output_path)

        except ffmpeg.Error as e:
            raise RuntimeError(f"Merge failed: {e.stderr.decode() if e.stderr else str(e)}")

    def detect_silence(
        self,
        audio_path: str,
        min_silence_len: int = 1000,
        silence_thresh: int = -40
    ) -> List[Tuple[int, int]]:
        """
        Detect silent portions in audio.

        Args:
            audio_path: Path to audio file
            min_silence_len: Minimum silence length in ms
            silence_thresh: Silence threshold in dB

        Returns:
            List of (start_ms, end_ms) tuples for silent portions
        """
        if not PYDUB_AVAILABLE:
            raise RuntimeError("pydub not available. Install with: pip install pydub")

        audio = AudioSegment.from_file(audio_path)
        silences = detect_silence(
            audio,
            min_silence_len=min_silence_len,
            silence_thresh=silence_thresh
        )
        return silences

    def split_on_silence(
        self,
        audio_path: str,
        output_dir: str,
        min_silence_len: int = 1000,
        silence_thresh: int = -40,
        keep_silence: int = 500
    ) -> List[str]:
        """
        Split audio file on silent portions.

        Args:
            audio_path: Path to audio file
            output_dir: Directory for output chunks
            min_silence_len: Minimum silence length in ms
            silence_thresh: Silence threshold in dB
            keep_silence: Amount of silence to keep at chunk edges in ms

        Returns:
            List of output file paths
        """
        if not PYDUB_AVAILABLE:
            raise RuntimeError("pydub not available. Install with: pip install pydub")

        audio_path = Path(audio_path)
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        audio = AudioSegment.from_file(str(audio_path))

        # Find non-silent chunks
        nonsilent_ranges = detect_nonsilent(
            audio,
            min_silence_len=min_silence_len,
            silence_thresh=silence_thresh
        )

        output_paths = []
        for i, (start, end) in enumerate(nonsilent_ranges):
            # Add padding
            chunk_start = max(0, start - keep_silence)
            chunk_end = min(len(audio), end + keep_silence)

            chunk = audio[chunk_start:chunk_end]
            output_path = output_dir / f"{audio_path.stem}_chunk_{i:04d}.wav"
            chunk.export(str(output_path), format="wav")
            output_paths.append(str(output_path))

        print(f"Split into {len(output_paths)} chunks")
        return output_paths

    def prepare_for_transcription(
        self,
        input_path: str,
        output_path: str,
        overwrite: bool = False
    ) -> str:
        """
        Prepare audio file for optimal transcription.

        Converts to:
        - WAV format
        - 16kHz sample rate
        - Mono channel
        - Normalized audio levels

        Args:
            input_path: Path to input audio/video file
            output_path: Path for output file

        Returns:
            Path to prepared audio file
        """
        input_path = Path(input_path)
        output_path = Path(output_path)

        if not input_path.exists():
            raise FileNotFoundError(f"Input file not found: {input_path}")

        if output_path.exists() and not overwrite:
            raise FileExistsError(f"Output file already exists: {output_path}")

        try:
            stream = ffmpeg.input(str(input_path))
            stream = ffmpeg.output(
                stream,
                str(output_path),
                format="wav",
                ar=16000,  # 16kHz sample rate
                ac=1,      # Mono
                af="loudnorm=I=-20:LRA=11:TP=-1.5"  # Normalize
            )

            if overwrite:
                stream = ffmpeg.overwrite_output(stream)

            ffmpeg.run(stream, capture_stdout=True, capture_stderr=True)
            print(f"Prepared for transcription: {input_path} -> {output_path}")
            return str(output_path)

        except ffmpeg.Error as e:
            raise RuntimeError(f"Preparation failed: {e.stderr.decode() if e.stderr else str(e)}")


def main():
    """Main entry point for CLI usage."""
    parser = argparse.ArgumentParser(
        description="Audio processing utilities using ffmpeg",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  info       Get audio file information
  convert    Convert audio format
  extract    Extract audio from video
  resample   Resample audio to different rate
  normalize  Normalize audio levels
  trim       Trim audio to time range
  prepare    Prepare audio for transcription

Examples:
  python audio_processor.py info recording.wav
  python audio_processor.py convert input.mp3 --output output.wav
  python audio_processor.py extract video.mp4 --output audio.wav
  python audio_processor.py resample audio.wav --sample-rate 16000 --output resampled.wav
  python audio_processor.py prepare meeting.mp4 --output meeting_ready.wav
        """
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Info command
    info_parser = subparsers.add_parser("info", help="Get audio file information")
    info_parser.add_argument("input_file", help="Input audio file")

    # Convert command
    convert_parser = subparsers.add_parser("convert", help="Convert audio format")
    convert_parser.add_argument("input_file", help="Input audio file")
    convert_parser.add_argument("--output", "-o", required=True, help="Output file path")
    convert_parser.add_argument("--format", "-f", help="Output format (wav, mp3, etc.)")
    convert_parser.add_argument("--sample-rate", "-r", type=int, help="Sample rate")
    convert_parser.add_argument("--channels", "-c", type=int, help="Number of channels")
    convert_parser.add_argument("--bitrate", "-b", help="Bitrate (e.g., 128k)")
    convert_parser.add_argument("--overwrite", "-y", action="store_true", help="Overwrite output")

    # Extract command
    extract_parser = subparsers.add_parser("extract", help="Extract audio from video")
    extract_parser.add_argument("input_file", help="Input video file")
    extract_parser.add_argument("--output", "-o", required=True, help="Output audio file")
    extract_parser.add_argument("--format", "-f", default="wav", help="Output format")
    extract_parser.add_argument("--sample-rate", "-r", type=int, default=16000, help="Sample rate")
    extract_parser.add_argument("--overwrite", "-y", action="store_true", help="Overwrite output")

    # Resample command
    resample_parser = subparsers.add_parser("resample", help="Resample audio")
    resample_parser.add_argument("input_file", help="Input audio file")
    resample_parser.add_argument("--output", "-o", required=True, help="Output file path")
    resample_parser.add_argument("--sample-rate", "-r", type=int, default=16000, help="Target sample rate")
    resample_parser.add_argument("--overwrite", "-y", action="store_true", help="Overwrite output")

    # Normalize command
    normalize_parser = subparsers.add_parser("normalize", help="Normalize audio levels")
    normalize_parser.add_argument("input_file", help="Input audio file")
    normalize_parser.add_argument("--output", "-o", required=True, help="Output file path")
    normalize_parser.add_argument("--target-db", "-t", type=float, default=-20.0, help="Target loudness (dB)")
    normalize_parser.add_argument("--overwrite", "-y", action="store_true", help="Overwrite output")

    # Trim command
    trim_parser = subparsers.add_parser("trim", help="Trim audio")
    trim_parser.add_argument("input_file", help="Input audio file")
    trim_parser.add_argument("--output", "-o", required=True, help="Output file path")
    trim_parser.add_argument("--start", "-s", type=float, required=True, help="Start time (seconds)")
    trim_parser.add_argument("--end", "-e", type=float, help="End time (seconds)")
    trim_parser.add_argument("--duration", "-d", type=float, help="Duration (seconds)")
    trim_parser.add_argument("--overwrite", "-y", action="store_true", help="Overwrite output")

    # Prepare command
    prepare_parser = subparsers.add_parser("prepare", help="Prepare audio for transcription")
    prepare_parser.add_argument("input_file", help="Input audio/video file")
    prepare_parser.add_argument("--output", "-o", required=True, help="Output file path")
    prepare_parser.add_argument("--overwrite", "-y", action="store_true", help="Overwrite output")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if not FFMPEG_AVAILABLE:
        print("Error: ffmpeg-python is not installed.", file=sys.stderr)
        print("Please run: pip install -r requirements.txt", file=sys.stderr)
        sys.exit(1)

    try:
        processor = AudioProcessor()

        if args.command == "info":
            info = processor.get_audio_info(args.input_file)
            print(json.dumps(info, indent=2))

        elif args.command == "convert":
            processor.convert(
                args.input_file,
                args.output,
                output_format=args.format,
                sample_rate=args.sample_rate,
                channels=args.channels,
                bitrate=args.bitrate,
                overwrite=args.overwrite
            )

        elif args.command == "extract":
            processor.extract_audio(
                args.input_file,
                args.output,
                output_format=args.format,
                sample_rate=args.sample_rate,
                overwrite=args.overwrite
            )

        elif args.command == "resample":
            processor.resample(
                args.input_file,
                args.output,
                sample_rate=args.sample_rate,
                overwrite=args.overwrite
            )

        elif args.command == "normalize":
            processor.normalize(
                args.input_file,
                args.output,
                target_db=args.target_db,
                overwrite=args.overwrite
            )

        elif args.command == "trim":
            processor.trim(
                args.input_file,
                args.output,
                start_time=args.start,
                end_time=args.end,
                duration=args.duration,
                overwrite=args.overwrite
            )

        elif args.command == "prepare":
            processor.prepare_for_transcription(
                args.input_file,
                args.output,
                overwrite=args.overwrite
            )

    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
