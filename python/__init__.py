"""
Meeting Notes Python Module

This module provides audio transcription and speaker diarization capabilities
for the Meeting Notes application.

Components:
    - transcribe: Audio transcription using WhisperX
    - diarize: Speaker diarization using pyannote.audio
    - audio_processor: Audio file processing utilities

Setup:
    Run ./setup_venv.sh to create the virtual environment and install dependencies.

Usage:
    from python.transcribe import Transcriber
    from python.diarize import Diarizer
    from python.audio_processor import AudioProcessor
"""

__version__ = "1.0.0"
__author__ = "Meeting Notes Team"

# Lazy imports to avoid loading heavy dependencies until needed
def get_transcriber():
    """Get the Transcriber class."""
    from .transcribe import Transcriber
    return Transcriber

def get_diarizer():
    """Get the Diarizer class."""
    from .diarize import Diarizer
    return Diarizer

def get_audio_processor():
    """Get the AudioProcessor class."""
    from .audio_processor import AudioProcessor
    return AudioProcessor
