#!/usr/bin/env python3
"""
check_setup.py - Verify Python environment setup for Meeting Notes

This script checks if all required dependencies are installed and working
correctly for the Meeting Notes transcription features.

Usage:
    python check_setup.py

    Or from the project root:
    python python/check_setup.py
"""

import sys
import os
import warnings

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

# Colors for terminal output
class Colors:
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    NC = '\033[0m'  # No Color
    BOLD = '\033[1m'


def print_header():
    """Print the header banner."""
    print(f"\n{Colors.BLUE}{'='*60}{Colors.NC}")
    print(f"{Colors.BLUE}  Meeting Notes - Python Setup Verification{Colors.NC}")
    print(f"{Colors.BLUE}{'='*60}{Colors.NC}\n")


def check_python_version():
    """Check if Python version is 3.10 or higher."""
    print(f"{Colors.YELLOW}Checking Python version...{Colors.NC}")
    major, minor = sys.version_info[:2]
    version = f"{major}.{minor}.{sys.version_info[2]}"

    if major >= 3 and minor >= 10:
        print(f"  {Colors.GREEN}Python {version}{Colors.NC}")
        return True
    else:
        print(f"  {Colors.RED}Python {version} - REQUIRES 3.10 or higher{Colors.NC}")
        return False


def check_whisperx():
    """Check if WhisperX is installed."""
    print(f"\n{Colors.YELLOW}Checking WhisperX...{Colors.NC}")
    try:
        import whisperx
        version = getattr(whisperx, '__version__', 'unknown')
        print(f"  {Colors.GREEN}whisperx {version}{Colors.NC}")
        return True
    except ImportError as e:
        print(f"  {Colors.RED}NOT INSTALLED: {e}{Colors.NC}")
        return False


def check_faster_whisper():
    """Check if faster-whisper is installed."""
    print(f"\n{Colors.YELLOW}Checking faster-whisper...{Colors.NC}")
    try:
        from faster_whisper import WhisperModel
        import faster_whisper
        version = getattr(faster_whisper, '__version__', 'unknown')
        print(f"  {Colors.GREEN}faster-whisper {version}{Colors.NC}")
        return True
    except ImportError as e:
        print(f"  {Colors.RED}NOT INSTALLED: {e}{Colors.NC}")
        return False


def check_torch():
    """Check if PyTorch is installed and if CUDA is available."""
    print(f"\n{Colors.YELLOW}Checking PyTorch...{Colors.NC}")
    try:
        import torch
        print(f"  {Colors.GREEN}torch {torch.__version__}{Colors.NC}")

        if torch.cuda.is_available():
            device_name = torch.cuda.get_device_name(0)
            print(f"  {Colors.GREEN}CUDA available: {device_name}{Colors.NC}")
        else:
            print(f"  {Colors.YELLOW}CUDA not available (will use CPU){Colors.NC}")

        return True
    except ImportError as e:
        print(f"  {Colors.RED}NOT INSTALLED: {e}{Colors.NC}")
        return False


def check_torchaudio():
    """Check if torchaudio is installed."""
    print(f"\n{Colors.YELLOW}Checking torchaudio...{Colors.NC}")
    try:
        import torchaudio
        print(f"  {Colors.GREEN}torchaudio {torchaudio.__version__}{Colors.NC}")
        return True
    except ImportError as e:
        print(f"  {Colors.RED}NOT INSTALLED: {e}{Colors.NC}")
        return False


def check_pyannote():
    """Check if pyannote.audio is installed."""
    print(f"\n{Colors.YELLOW}Checking pyannote.audio...{Colors.NC}")
    try:
        from pyannote.audio import Pipeline
        import pyannote.audio
        version = getattr(pyannote.audio, '__version__', 'unknown')
        print(f"  {Colors.GREEN}pyannote.audio {version}{Colors.NC}")
        return True
    except ImportError as e:
        print(f"  {Colors.RED}NOT INSTALLED: {e}{Colors.NC}")
        return False


def check_ffmpeg_python():
    """Check if ffmpeg-python is installed."""
    print(f"\n{Colors.YELLOW}Checking ffmpeg-python...{Colors.NC}")
    try:
        import ffmpeg
        print(f"  {Colors.GREEN}ffmpeg-python installed{Colors.NC}")
        return True
    except ImportError as e:
        print(f"  {Colors.RED}NOT INSTALLED: {e}{Colors.NC}")
        return False


def check_ffmpeg_binary():
    """Check if ffmpeg binary is available in PATH."""
    print(f"\n{Colors.YELLOW}Checking ffmpeg binary...{Colors.NC}")
    import shutil
    ffmpeg_path = shutil.which('ffmpeg')
    if ffmpeg_path:
        print(f"  {Colors.GREEN}ffmpeg found at: {ffmpeg_path}{Colors.NC}")
        return True
    else:
        print(f"  {Colors.RED}ffmpeg NOT FOUND in PATH{Colors.NC}")
        print(f"  {Colors.YELLOW}Install with: brew install ffmpeg (macOS) or apt-get install ffmpeg (Linux){Colors.NC}")
        return False


def check_other_deps():
    """Check other required dependencies."""
    print(f"\n{Colors.YELLOW}Checking other dependencies...{Colors.NC}")

    deps = [
        ('numpy', 'numpy'),
        ('soundfile', 'soundfile'),
        ('pydub', 'pydub'),
        ('tqdm', 'tqdm'),
    ]

    all_ok = True
    for name, module in deps:
        try:
            __import__(module)
            print(f"  {Colors.GREEN}{name}{Colors.NC}")
        except ImportError as e:
            print(f"  {Colors.RED}{name} - NOT INSTALLED: {e}{Colors.NC}")
            all_ok = False

    return all_ok


def print_summary(results):
    """Print a summary of the check results."""
    print(f"\n{Colors.BLUE}{'='*60}{Colors.NC}")
    print(f"{Colors.BOLD}Summary{Colors.NC}")
    print(f"{Colors.BLUE}{'='*60}{Colors.NC}\n")

    critical_ok = results['python'] and (results['whisperx'] or results['faster_whisper'])

    if critical_ok:
        print(f"{Colors.GREEN}Core transcription dependencies are installed!{Colors.NC}")

        if results['whisperx']:
            print(f"  Using: WhisperX (recommended)")
        else:
            print(f"  Using: faster-whisper (fallback)")

        if not results['torch']:
            print(f"\n{Colors.YELLOW}Warning: PyTorch not detected. Transcription may not work.{Colors.NC}")

        if not results['ffmpeg_binary']:
            print(f"\n{Colors.YELLOW}Warning: ffmpeg not found. Audio processing may fail.{Colors.NC}")

        print(f"\n{Colors.GREEN}Live transcription should work!{Colors.NC}")
    else:
        print(f"{Colors.RED}Missing critical dependencies!{Colors.NC}\n")

        if not results['python']:
            print(f"  - Python 3.10+ is required")

        if not results['whisperx'] and not results['faster_whisper']:
            print(f"  - Neither WhisperX nor faster-whisper is installed")

        print(f"\n{Colors.YELLOW}To fix this, run the setup script:{Colors.NC}")
        script_dir = os.path.dirname(os.path.abspath(__file__))
        print(f"  cd \"{script_dir}\"")
        print(f"  ./setup_venv.sh")

    print()


def check_venv():
    """Check if running inside a virtual environment."""
    print(f"{Colors.YELLOW}Checking virtual environment...{Colors.NC}")

    # Check for virtual environment indicators
    in_venv = hasattr(sys, 'real_prefix') or \
              (hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix) or \
              os.environ.get('VIRTUAL_ENV') is not None

    if in_venv:
        venv_path = os.environ.get('VIRTUAL_ENV', sys.prefix)
        print(f"  {Colors.GREEN}Running in virtual environment: {venv_path}{Colors.NC}")
    else:
        print(f"  {Colors.YELLOW}NOT running in a virtual environment{Colors.NC}")
        print(f"  {Colors.YELLOW}Consider activating the venv: source python/venv-3.12/bin/activate{Colors.NC}")

    print(f"  Python executable: {sys.executable}")
    return in_venv


def main():
    """Run all checks and print summary."""
    print_header()

    results = {}

    # Check virtual environment
    check_venv()

    # Run all checks
    results['python'] = check_python_version()
    results['torch'] = check_torch()
    results['torchaudio'] = check_torchaudio()
    results['whisperx'] = check_whisperx()
    results['faster_whisper'] = check_faster_whisper()
    results['pyannote'] = check_pyannote()
    results['ffmpeg_python'] = check_ffmpeg_python()
    results['ffmpeg_binary'] = check_ffmpeg_binary()
    results['other'] = check_other_deps()

    # Print summary
    print_summary(results)

    # Return exit code based on critical dependencies
    if results['python'] and (results['whisperx'] or results['faster_whisper']):
        return 0
    else:
        return 1


if __name__ == '__main__':
    sys.exit(main())
