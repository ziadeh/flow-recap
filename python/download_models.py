#!/usr/bin/env python3
"""
PyAnnote Model Download Script

Downloads required PyAnnote models from HuggingFace Hub.
Outputs progress in a format parseable by the Electron app.

Progress format: [PROGRESS] model_id percentage message
Complete format: [COMPLETE] model_id
Error format: [ERROR] model_id message
License format: [LICENSE_REQUIRED] model_id url

Usage:
    python download_models.py

Environment Variables:
    HF_TOKEN: HuggingFace API token (required)
    MODELS_DIR: Optional custom directory to store models
"""

import os
import sys
import time
import warnings
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

# Suppress warnings for cleaner output
warnings.filterwarnings("ignore")

# Maximum retry attempts for network failures
MAX_RETRIES = 3
# Base delay for exponential backoff (in seconds)
BASE_RETRY_DELAY = 2

# Model configurations with expected files for verification
MODEL_CONFIGS: Dict[str, Dict[str, Any]] = {
    'pyannote-segmentation-3.0': {
        'repo_id': 'pyannote/segmentation-3.0',
        'display_name': 'Segmentation Model',
        'type': 'regular',  # Regular model with weight files
        'expected_files': ['pytorch_model.bin', 'config.yaml'],
        'min_size_bytes': 10 * 1024 * 1024,  # 10 MB minimum
        'license_url': 'https://huggingface.co/pyannote/segmentation-3.0',
    },
    'pyannote-embedding': {
        'repo_id': 'pyannote/wespeaker-voxceleb-resnet34-LM',
        'display_name': 'Speaker Embedding Model',
        'type': 'regular',
        'expected_files': ['pytorch_model.bin'],
        'min_size_bytes': 10 * 1024 * 1024,  # 10 MB minimum
        'license_url': 'https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM',
    },
    'pyannote-speaker-diarization-3.1': {
        'repo_id': 'pyannote/speaker-diarization-3.1',
        'display_name': 'Speaker Diarization Pipeline',
        'type': 'pipeline',  # Pipeline model with config files
        'expected_files': ['config.yaml'],
        'min_size_bytes': 1024,  # 1 KB minimum (pipeline configs are smaller)
        'license_url': 'https://huggingface.co/pyannote/speaker-diarization-3.1',
    },
}

def print_progress(model_id: str, progress: int, message: str):
    """Print progress in parseable format."""
    print(f"[PROGRESS] {model_id} {progress} {message}", file=sys.stderr, flush=True)

def print_complete(model_id: str):
    """Print completion in parseable format."""
    print(f"[COMPLETE] {model_id}", file=sys.stderr, flush=True)

def print_error(model_id: str, message: str):
    """Print error in parseable format."""
    print(f"[ERROR] {model_id} {message}", file=sys.stderr, flush=True)

def print_license_required(model_id: str, url: str):
    """Print license requirement message in parseable format."""
    print(f"[LICENSE_REQUIRED] {model_id} {url}", file=sys.stderr, flush=True)

def print_debug(message: str):
    """Print debug message for troubleshooting."""
    print(f"[DEBUG] {message}", file=sys.stderr, flush=True)

def get_hf_cache_dir() -> str:
    """Get the HuggingFace cache directory."""
    # Check environment variables first
    if os.environ.get('HF_HOME'):
        return os.environ.get('HF_HOME')
    if os.environ.get('HUGGINGFACE_HUB_CACHE'):
        return os.environ.get('HUGGINGFACE_HUB_CACHE')

    # Default locations
    home = os.path.expanduser('~')
    if sys.platform == 'win32':
        return os.path.join(home, '.cache', 'huggingface')
    else:
        return os.path.join(home, '.cache', 'huggingface')


def get_total_file_size(directory: Path) -> int:
    """Calculate total size of all files in a directory recursively."""
    total_size = 0
    try:
        for item in directory.rglob('*'):
            if item.is_file():
                total_size += item.stat().st_size
    except Exception as e:
        print_debug(f"Error calculating size for {directory}: {e}")
    return total_size


def check_model_access(repo_id: str, token: str) -> Tuple[bool, Optional[str]]:
    """
    Check if the user has access to a gated model.
    Returns (has_access, error_message).
    """
    try:
        from huggingface_hub import HfApi
        api = HfApi()

        # Try to get model info - this will fail for gated models if access not granted
        try:
            model_info = api.model_info(repo_id, token=token)
            return True, None
        except Exception as e:
            error_str = str(e)
            if "403" in error_str or "401" in error_str or "gated" in error_str.lower():
                return False, f"License agreement required. Visit https://huggingface.co/{repo_id} to accept terms."
            elif "404" in error_str:
                return False, f"Model not found: {repo_id}"
            else:
                # Other errors might be network issues - allow to proceed
                print_debug(f"Warning checking access for {repo_id}: {e}")
                return True, None
    except ImportError:
        # If HfApi not available, allow to proceed
        return True, None


def validate_token_permissions(token: str) -> Tuple[bool, Optional[str]]:
    """
    Validate that the HuggingFace token has the required permissions.
    Returns (is_valid, error_message).
    """
    if not token:
        return False, "HuggingFace token is required but not provided."

    try:
        from huggingface_hub import HfApi
        api = HfApi()

        # Verify token by getting user info
        try:
            user_info = api.whoami(token=token)
            print_debug(f"Token validated for user: {user_info.get('name', 'unknown')}")
            return True, None
        except Exception as e:
            error_str = str(e)
            if "401" in error_str:
                return False, "Invalid HuggingFace token. Please check your token in Settings."
            else:
                print_debug(f"Warning validating token: {e}")
                # Other errors might be network issues - allow to proceed
                return True, None
    except ImportError:
        return True, None

def verify_model_in_cache(model_id: str, repo_id: str) -> Tuple[bool, Optional[str]]:
    """
    Verify that model files exist in the HF cache location.
    Returns (is_verified, error_message).
    """
    config = MODEL_CONFIGS.get(model_id)
    if not config:
        return False, f"Unknown model ID: {model_id}"

    hf_cache = get_hf_cache_dir()
    hub_path = Path(hf_cache) / 'hub'

    if not hub_path.exists():
        return False, f"HuggingFace cache directory not found: {hub_path}"

    # Map model IDs to cache directory patterns
    # Updated to include the correct embedding model path
    model_patterns = {
        'pyannote-speaker-diarization-3.1': ['models--pyannote--speaker-diarization-3.1'],
        'pyannote-segmentation-3.0': ['models--pyannote--segmentation-3.0'],
        'pyannote-embedding': [
            'models--pyannote--wespeaker-voxceleb-resnet34-LM',
            'models--pyannote--embedding',  # Legacy path
            'models--speechbrain--spkrec-ecapa-voxceleb'  # Alternative embedding
        ]
    }

    patterns = model_patterns.get(model_id, [])
    model_type = config.get('type', 'regular')
    expected_files = config.get('expected_files', [])
    min_size = config.get('min_size_bytes', 0)

    for pattern in patterns:
        model_dir = hub_path / pattern
        if not model_dir.exists():
            print_debug(f"Pattern {pattern} not found at {model_dir}")
            continue

        # Check snapshots directory
        snapshots_dir = model_dir / 'snapshots'
        if not snapshots_dir.exists():
            print_debug(f"Snapshots directory not found: {snapshots_dir}")
            continue

        snapshots = [d for d in snapshots_dir.iterdir() if d.is_dir()]
        if not snapshots:
            print_debug(f"No snapshots found in {snapshots_dir}")
            continue

        # Use the most recent snapshot (sorted by name, which is typically a hash)
        snapshot_path = sorted(snapshots, key=lambda x: x.stat().st_mtime, reverse=True)[0]
        print_debug(f"Checking snapshot: {snapshot_path}")

        if model_type == 'pipeline':
            # For pipeline models, check for config.yaml
            found_config = False
            found_files = []

            # Check all files recursively
            for file_path in snapshot_path.rglob('*'):
                if file_path.is_file():
                    if file_path.name == 'config.yaml':
                        found_config = True
                        found_files.append(str(file_path))
                        print_debug(f"Found config.yaml: {file_path}")

            if found_config:
                # Verify minimum size
                total_size = get_total_file_size(snapshot_path)
                print_debug(f"Pipeline model total size: {total_size} bytes (min: {min_size})")
                if total_size >= min_size:
                    print_debug(f"[verify] Pipeline model {model_id} verified successfully")
                    return True, None
                else:
                    return False, f"Model files incomplete. Expected min {min_size} bytes, got {total_size} bytes."

            print_debug(f"[verify] Pipeline model verification failed: config.yaml not found")
        else:
            # For regular models, check for weight files (.bin, .pt, .safetensors, .ckpt)
            weight_extensions = ('.bin', '.pt', '.safetensors', '.ckpt')
            found_weights = []

            for file_path in snapshot_path.rglob('*'):
                if file_path.is_file():
                    if file_path.name.endswith(weight_extensions):
                        found_weights.append(file_path)
                        print_debug(f"Found weight file: {file_path}")

            if found_weights:
                # Verify minimum size
                total_size = get_total_file_size(snapshot_path)
                print_debug(f"Regular model total size: {total_size} bytes (min: {min_size})")
                if total_size >= min_size:
                    print_debug(f"[verify] Regular model {model_id} verified successfully")
                    return True, None
                else:
                    return False, f"Model files incomplete. Expected min {min_size} bytes, got {total_size} bytes."

            print_debug(f"[verify] Regular model verification failed: no weight files found")

    return False, f"Model not found in HuggingFace cache. Checked patterns: {patterns}"


def download_with_retry(repo_id: str, token: str, model_id: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Download a model with retry logic and exponential backoff.
    Returns (local_dir, error_message).
    """
    from huggingface_hub import snapshot_download
    from huggingface_hub.utils import RepositoryNotFoundError, HfHubHTTPError

    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print_debug(f"Download attempt {attempt}/{MAX_RETRIES} for {repo_id}")

            # Download the model
            local_dir = snapshot_download(
                repo_id=repo_id,
                token=token,
                local_dir_use_symlinks=False,
                ignore_patterns=None  # Download all files
            )

            return local_dir, None

        except RepositoryNotFoundError:
            # Don't retry for repository not found - this is a permanent error
            config = MODEL_CONFIGS.get(model_id, {})
            license_url = config.get('license_url', f'https://huggingface.co/{repo_id}')
            error_msg = (
                f"Repository not found or access denied: {repo_id}. "
                f"Please ensure you have:\n"
                f"1. Accepted the model license at {license_url}\n"
                f"2. Used a valid HuggingFace token with 'read' permissions"
            )
            return None, error_msg

        except HfHubHTTPError as e:
            error_str = str(e)
            if "401" in error_str or "403" in error_str:
                # Don't retry for authentication errors
                config = MODEL_CONFIGS.get(model_id, {})
                license_url = config.get('license_url', f'https://huggingface.co/{repo_id}')
                error_msg = (
                    f"Access denied for {repo_id}. "
                    f"Please visit {license_url} to accept the model license agreement, "
                    f"then try downloading again."
                )
                return None, error_msg
            else:
                # Network error - retry with backoff
                last_error = f"HTTP error: {e}"
                if attempt < MAX_RETRIES:
                    delay = BASE_RETRY_DELAY * (2 ** (attempt - 1))  # Exponential backoff
                    print_debug(f"Network error, retrying in {delay}s: {e}")
                    time.sleep(delay)

        except Exception as e:
            # Generic error - retry with backoff
            last_error = f"Download error: {e}"
            if attempt < MAX_RETRIES:
                delay = BASE_RETRY_DELAY * (2 ** (attempt - 1))
                print_debug(f"Error downloading, retrying in {delay}s: {e}")
                time.sleep(delay)

    return None, f"Failed after {MAX_RETRIES} attempts. Last error: {last_error}"

def download_models():
    """Download all required PyAnnote models with improved error handling and verification."""

    hf_token = os.environ.get('HF_TOKEN')
    if not hf_token:
        print_error("all", "HuggingFace token not provided. Please save your token in Settings and try again.")
        sys.exit(1)

    # Import huggingface_hub for downloads
    try:
        from huggingface_hub import login
        from huggingface_hub.utils import RepositoryNotFoundError, HfHubHTTPError
    except ImportError as e:
        print_error("all", f"huggingface_hub not installed: {e}")
        sys.exit(1)

    # Pre-download validation: Check token permissions
    print_progress("all", 2, "Validating HuggingFace token...")
    token_valid, token_error = validate_token_permissions(hf_token)
    if not token_valid:
        print_error("all", token_error)
        sys.exit(1)

    # Login to HuggingFace
    try:
        print_progress("all", 5, "Authenticating with HuggingFace...")
        login(token=hf_token, add_to_git_credential=False)
    except Exception as e:
        print_error("all", f"Failed to authenticate: {e}")
        sys.exit(1)

    # Build models list from MODEL_CONFIGS (uses correct repository IDs)
    models_to_download = [
        (model_id, config['repo_id'])
        for model_id, config in MODEL_CONFIGS.items()
    ]

    total_models = len(models_to_download)
    errors_occurred = False
    license_errors = []

    # Pre-download validation: Check access to all gated models
    print_progress("all", 8, "Checking model access permissions...")
    for model_id, repo_id in models_to_download:
        config = MODEL_CONFIGS.get(model_id, {})
        has_access, access_error = check_model_access(repo_id, hf_token)
        if not has_access:
            license_url = config.get('license_url', f'https://huggingface.co/{repo_id}')
            print_license_required(model_id, license_url)
            license_errors.append((model_id, access_error))

    # If any license errors, report them all and exit
    if license_errors:
        for model_id, error in license_errors:
            print_error(model_id, error)
        print_error("all",
            "Some models require license acceptance. "
            "Please visit the URLs above and accept the model licenses, then try again.")
        sys.exit(1)

    # Download each model with per-model progress reporting
    for idx, (model_id, repo_id) in enumerate(models_to_download):
        config = MODEL_CONFIGS.get(model_id, {})
        display_name = config.get('display_name', model_id)
        license_url = config.get('license_url', f'https://huggingface.co/{repo_id}')

        # Calculate progress ranges for this model
        model_progress_start = int(10 + (idx / total_models) * 80)  # 10-90%
        model_progress_end = int(10 + ((idx + 1) / total_models) * 80)

        try:
            # Step 1: Check if already downloaded and verified
            print_progress(model_id, model_progress_start, f"Checking if {display_name} is already cached...")
            is_verified, _ = verify_model_in_cache(model_id, repo_id)

            if is_verified:
                print_progress(model_id, model_progress_end, f"{display_name} already downloaded and verified")
                print_complete(model_id)
                continue

            # Step 2: Download the model with retry logic
            print_progress(model_id, model_progress_start + 5, f"Downloading {display_name}...")

            local_dir, download_error = download_with_retry(repo_id, hf_token, model_id)

            if download_error:
                # Check if it's a license error
                if "accept" in download_error.lower() or "license" in download_error.lower():
                    print_license_required(model_id, license_url)
                print_error(model_id, download_error)
                errors_occurred = True
                continue

            # Step 3: Post-download verification
            print_progress(model_id, model_progress_end - 5, f"Verifying {display_name}...")

            # Small delay to ensure filesystem sync
            time.sleep(0.5)

            # Verify the download
            is_verified, verify_error = verify_model_in_cache(model_id, repo_id)

            if is_verified:
                print_progress(model_id, model_progress_end, f"{display_name} downloaded and verified successfully")
                print_complete(model_id)
            else:
                # Fallback: Check the local_dir returned by snapshot_download
                if local_dir and os.path.isdir(local_dir):
                    actual_path = os.path.realpath(local_dir)
                    model_type = config.get('type', 'regular')
                    min_size = config.get('min_size_bytes', 0)

                    # Check total size
                    total_size = get_total_file_size(Path(actual_path))

                    if total_size >= min_size:
                        # Check for expected files
                        has_expected_files = False
                        weight_extensions = ('.bin', '.pt', '.safetensors', '.ckpt')

                        for root, dirs, filenames in os.walk(actual_path):
                            if model_type == 'pipeline':
                                if 'config.yaml' in filenames:
                                    has_expected_files = True
                                    break
                            else:
                                if any(f.endswith(weight_extensions) for f in filenames):
                                    has_expected_files = True
                                    break

                        if has_expected_files:
                            print_debug(f"Fallback verification passed for {model_id}")
                            print_progress(model_id, model_progress_end, f"{display_name} downloaded successfully (fallback verification)")
                            print_complete(model_id)
                            continue

                # If we get here, verification failed
                error_msg = verify_error or f"Model files not found after download"
                print_error(model_id, f"Download verification failed: {error_msg}")
                errors_occurred = True

        except RepositoryNotFoundError:
            print_license_required(model_id, license_url)
            error_msg = (
                f"Repository not found: {repo_id}. "
                f"Please ensure you have accepted the model terms at {license_url}"
            )
            print_error(model_id, error_msg)
            errors_occurred = True

        except HfHubHTTPError as e:
            error_str = str(e)
            if "401" in error_str or "403" in error_str:
                print_license_required(model_id, license_url)
                error_msg = (
                    f"Access denied for {repo_id}. "
                    f"Please accept the model terms at {license_url}"
                )
            else:
                error_msg = f"HTTP error downloading {display_name}: {e}"
            print_error(model_id, error_msg)
            errors_occurred = True

        except Exception as e:
            print_error(model_id, f"Failed to download {display_name}: {e}")
            errors_occurred = True

    # Final status
    if errors_occurred:
        print_progress("all", 100, "Download completed with some errors")
        sys.exit(1)
    else:
        print_progress("all", 100, "All models downloaded successfully!")
        print("[DOWNLOAD_COMPLETE]", file=sys.stderr, flush=True)
        sys.exit(0)


if __name__ == "__main__":
    download_models()
