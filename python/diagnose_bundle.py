#!/usr/bin/env python3
"""
diagnose_bundle.py - Comprehensive diagnostic tool for PyInstaller bundle

This script performs detailed diagnostics on the bundled Python environment to
identify import issues, missing modules, and sys.path problems.

Usage:
    python diagnose_bundle.py
    OR: transcription_bundle check_bundle (if added to _bundle_entry.py)
"""

import sys
import os
import importlib
import warnings

# Suppress warnings
warnings.filterwarnings("ignore")

# Colors for terminal output
class Colors:
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    CYAN = '\033[0;36m'
    NC = '\033[0m'  # No Color
    BOLD = '\033[1m'


def print_header():
    """Print the diagnostic header."""
    print(f"\n{Colors.BLUE}{'='*70}{Colors.NC}")
    print(f"{Colors.BLUE}  PyInstaller Bundle Diagnostic Tool{Colors.NC}")
    print(f"{Colors.BLUE}{'='*70}{Colors.NC}\n")


def check_bundled_mode():
    """Check if running in bundled (frozen) mode."""
    print(f"{Colors.CYAN}[1] Checking Bundle Mode{Colors.NC}")
    is_frozen = getattr(sys, 'frozen', False)
    meipass = getattr(sys, '_MEIPASS', None)

    print(f"  frozen: {Colors.GREEN if is_frozen else Colors.YELLOW}{is_frozen}{Colors.NC}")
    print(f"  _MEIPASS: {Colors.GREEN if meipass else Colors.YELLOW}{meipass}{Colors.NC}")
    print(f"  executable: {sys.executable}")

    return is_frozen


def check_sys_path():
    """Check sys.path configuration."""
    print(f"\n{Colors.CYAN}[2] Checking sys.path{Colors.NC}")
    print(f"  Total paths: {len(sys.path)}")
    print(f"  First 5 paths:")
    for i, p in enumerate(sys.path[:5], 1):
        exists = os.path.exists(p) if p else False
        status = f"{Colors.GREEN}✓{Colors.NC}" if exists else f"{Colors.RED}✗{Colors.NC}"
        print(f"    {status} [{i}] {p}")

    # Check for critical paths
    meipass = getattr(sys, '_MEIPASS', None)
    if meipass:
        internal_path = os.path.join(meipass)
        if internal_path in sys.path:
            print(f"  {Colors.GREEN}✓{Colors.NC} _MEIPASS is in sys.path")
        else:
            print(f"  {Colors.RED}✗{Colors.NC} _MEIPASS is NOT in sys.path (this may cause import issues)")


def check_python_version():
    """Check Python version."""
    print(f"\n{Colors.CYAN}[3] Python Version{Colors.NC}")
    version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    print(f"  {Colors.GREEN}{version}{Colors.NC}")


def check_critical_imports():
    """Test importing critical packages."""
    print(f"\n{Colors.CYAN}[4] Critical Package Imports{Colors.NC}")

    packages = {
        'torch': 'PyTorch',
        'torchaudio': 'TorchAudio',
        'whisperx': 'WhisperX',
        'faster_whisper': 'Faster Whisper',
        'ctranslate2': 'CTranslate2',
        'pyannote.audio': 'Pyannote Audio',
    }

    results = {}
    for pkg_name, display_name in packages.items():
        try:
            # Try basic import
            if '.' in pkg_name:
                parts = pkg_name.split('.')
                module = __import__(pkg_name)
                for part in parts[1:]:
                    module = getattr(module, part)
            else:
                module = __import__(pkg_name)

            # Get version if available
            version = getattr(module, '__version__', 'unknown')
            results[pkg_name] = {'success': True, 'version': version, 'error': None}
            print(f"  {Colors.GREEN}✓{Colors.NC} {display_name:20s} v{version}")
        except ImportError as e:
            results[pkg_name] = {'success': False, 'version': None, 'error': str(e)}
            print(f"  {Colors.RED}✗{Colors.NC} {display_name:20s} - {Colors.RED}ImportError{Colors.NC}")
            print(f"    └─ {str(e)[:70]}")
        except Exception as e:
            results[pkg_name] = {'success': False, 'version': None, 'error': str(e)}
            print(f"  {Colors.RED}✗{Colors.NC} {display_name:20s} - {Colors.RED}{type(e).__name__}{Colors.NC}")
            print(f"    └─ {str(e)[:70]}")

    return results


def check_torch_backends():
    """Check PyTorch backend availability."""
    print(f"\n{Colors.CYAN}[5] PyTorch Backends{Colors.NC}")

    try:
        import torch

        # CUDA
        cuda_available = torch.cuda.is_available()
        print(f"  CUDA: {Colors.GREEN if cuda_available else Colors.YELLOW}{'Available' if cuda_available else 'Not available'}{Colors.NC}")

        # MPS (Metal Performance Shaders - Apple Silicon)
        if hasattr(torch, 'mps') and hasattr(torch.mps, 'is_available'):
            mps_available = torch.mps.is_available()
            print(f"  MPS:  {Colors.GREEN if mps_available else Colors.YELLOW}{'Available' if mps_available else 'Not available'}{Colors.NC}")

        # Default device
        print(f"  Default device: {torch.get_default_device() if hasattr(torch, 'get_default_device') else 'cpu'}")
    except Exception as e:
        print(f"  {Colors.RED}Error checking torch backends: {e}{Colors.NC}")


def check_torchaudio_backend():
    """Check torchaudio backend configuration."""
    print(f"\n{Colors.CYAN}[6] TorchAudio Backend{Colors.NC}")

    try:
        import torchaudio
        import torchaudio.backend

        # Try to get current backend
        try:
            # In newer versions
            backend = torchaudio.get_audio_backend()
            print(f"  Current backend: {Colors.GREEN}{backend}{Colors.NC}")
        except:
            # In older versions or if not set
            print(f"  Current backend: {Colors.YELLOW}Unable to determine{Colors.NC}")

        # Check soundfile backend
        try:
            from torchaudio.backend import soundfile_backend
            print(f"  {Colors.GREEN}✓{Colors.NC} soundfile_backend available")
        except ImportError as e:
            print(f"  {Colors.RED}✗{Colors.NC} soundfile_backend NOT available: {e}")

    except Exception as e:
        print(f"  {Colors.RED}Error checking torchaudio backend: {e}{Colors.NC}")


def check_module_locations():
    """Check where critical modules are actually located."""
    print(f"\n{Colors.CYAN}[7] Module Locations{Colors.NC}")

    modules = ['torch', 'torchaudio', 'whisperx', 'faster_whisper', 'ctranslate2']

    for module_name in modules:
        try:
            module = __import__(module_name)
            location = getattr(module, '__file__', None)
            if location:
                # Shorten path for readability
                meipass = getattr(sys, '_MEIPASS', '')
                if meipass and location.startswith(meipass):
                    location = location.replace(meipass, '$MEIPASS')
                print(f"  {Colors.GREEN}✓{Colors.NC} {module_name:20s} → {location[:60]}")
            else:
                print(f"  {Colors.YELLOW}?{Colors.NC} {module_name:20s} → (no __file__ attribute)")
        except ImportError:
            print(f"  {Colors.RED}✗{Colors.NC} {module_name:20s} → NOT IMPORTABLE")


def check_environment_variables():
    """Check critical environment variables."""
    print(f"\n{Colors.CYAN}[8] Environment Variables{Colors.NC}")

    env_vars = [
        'HF_TOKEN',
        'HF_HOME',
        'HUGGING_FACE_HUB_TOKEN',
        'TORCH_HOME',
        'MEETING_NOTES_BUNDLED',
        'PYTHONPATH',
    ]

    for var in env_vars:
        value = os.environ.get(var)
        if value:
            # Sanitize tokens (show only first/last few chars)
            if 'TOKEN' in var and len(value) > 10:
                display_value = f"{value[:4]}...{value[-4:]}"
            else:
                display_value = value[:50]
            print(f"  {Colors.GREEN}✓{Colors.NC} {var:25s} = {display_value}")
        else:
            print(f"  {Colors.YELLOW}○{Colors.NC} {var:25s} (not set)")


def run_diagnostics():
    """Run all diagnostic checks."""
    print_header()

    is_bundled = check_bundled_mode()
    check_sys_path()
    check_python_version()
    import_results = check_critical_imports()

    # Only check backends if torch imported successfully
    if import_results.get('torch', {}).get('success'):
        check_torch_backends()

    if import_results.get('torchaudio', {}).get('success'):
        check_torchaudio_backend()

    check_module_locations()
    check_environment_variables()

    # Summary
    print(f"\n{Colors.BLUE}{'='*70}{Colors.NC}")
    print(f"{Colors.BOLD}Summary{Colors.NC}")
    print(f"{Colors.BLUE}{'='*70}{Colors.NC}\n")

    total = len(import_results)
    passed = sum(1 for r in import_results.values() if r['success'])
    failed = total - passed

    if failed == 0:
        print(f"  {Colors.GREEN}✓ All {total} critical packages imported successfully!{Colors.NC}")
        print(f"  {Colors.GREEN}✓ Bundle appears to be working correctly.{Colors.NC}")
        return 0
    else:
        print(f"  {Colors.RED}✗ {failed} out of {total} packages failed to import.{Colors.NC}")
        print(f"\n{Colors.YELLOW}Recommendations:{Colors.NC}")
        print(f"  1. Rebuild the bundle with: npm run bundle:python:clean")
        print(f"  2. Check that all dependencies are installed in the venv")
        print(f"  3. Verify PyInstaller hooks are working correctly")
        print(f"  4. Check the transcription_bundle.spec file for missing hidden imports")
        return 1


def main():
    """Main entry point."""
    try:
        exit_code = run_diagnostics()
        print()  # Final newline
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Diagnostic interrupted by user.{Colors.NC}\n")
        sys.exit(130)
    except Exception as e:
        print(f"\n\n{Colors.RED}Unexpected error: {e}{Colors.NC}\n")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
