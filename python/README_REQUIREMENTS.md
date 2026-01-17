# Meeting Notes - Python Requirements Documentation

## Overview

Meeting Notes uses a **split requirements file system** to manage Python dependencies for two distinct ML pipelines:

1. **WhisperX Pipeline** - Speech-to-text transcription with word-level timestamps
2. **Pyannote Pipeline** - Speaker diarization (identifying who spoke when)

These pipelines require **incompatible PyTorch versions**, necessitating separate virtual environments.

## Requirements File Structure

```
python/
├── requirements-whisperx.txt    # WhisperX transcription dependencies
├── requirements-pyannote.txt    # Pyannote diarization dependencies
├── requirements-common.txt      # Shared utilities (safe to install in both)
├── requirements-whisperx.lock   # Locked versions for reproducibility
├── requirements-pyannote.lock   # Locked versions for reproducibility
├── requirements.txt             # Legacy unified file (deprecated)
└── README_REQUIREMENTS.md       # This documentation
```

## Version Constraints & Conflict Explanations

### Primary Conflict: PyTorch Version

| Environment | PyTorch Version | Reason |
|-------------|-----------------|--------|
| WhisperX | `torch==2.8.0` | WhisperX optimized for latest torch; requires newer attention mechanisms and memory management |
| Pyannote | `torch==2.5.1` | Pyannote models use `weights_only=False` for loading; torch 2.8+ defaults to `weights_only=True` causing load failures |

**Root Cause**: PyTorch 2.6+ changed the default behavior of `torch.load()` to use `weights_only=True` for security. Pyannote models were serialized with additional metadata that requires `weights_only=False`.

### Secondary Constraints

| Package | WhisperX | Pyannote | Reason |
|---------|----------|----------|--------|
| `torchaudio` | `2.5.0` | `2.5.1` | Must match PyTorch major.minor version |
| `numpy` | `<2.0` | `>=1.24.0` | WhisperX/librosa incompatible with NumPy 2.0 API changes |
| `pytorch-lightning` | Not required | `==2.6.0` | Pinned for speechbrain compatibility |

### Package-Specific Version Constraints

#### WhisperX Environment

| Package | Version | Constraint Reason |
|---------|---------|-------------------|
| `whisperx` | `>=3.0` | Minimum for VAD-based chunking support |
| `faster-whisper` | `>=1.0` | CTranslate2 v4 backend required |
| `openai-whisper` | `>=20240930` | Fallback with latest model support |
| `transformers` | `>=4.40` | Required for Whisper model loading |
| `librosa` | `>=0.10` | Audio feature extraction |
| `numba` | `>=0.60` | JIT compilation for audio processing |
| `numpy` | `<2.0` | **CRITICAL**: librosa breaks with NumPy 2.0 |

#### Pyannote Environment

| Package | Version | Constraint Reason |
|---------|---------|-------------------|
| `pyannote.audio` | `==3.4.0` | Pinned for model compatibility |
| `speechbrain` | `>=1.0` | Alternative embedding extraction |
| `pytorch-lightning` | `==2.6.0` | Pinned for speechbrain compatibility |
| `torchmetrics` | `>=1.0` | Required by pytorch-lightning |
| `asteroid-filterbanks` | `>=0.4` | Audio preprocessing |
| `pyannote.core` | `>=5.0` | Core data structures |
| `pyannote.database` | `>=5.1` | Database management |
| `pyannote.metrics` | `>=3.2` | Evaluation metrics (DER) |
| `pyannote.pipeline` | `>=3.0` | Pipeline infrastructure |

#### Common Utilities

| Package | Version | Purpose |
|---------|---------|---------|
| `huggingface_hub` | `>=0.20` | Model downloading and caching |
| `safetensors` | `>=0.4` | Safe tensor serialization |
| `omegaconf` | `>=2.3` | Configuration management |
| `matplotlib` | `>=3.7` | Visualization |

## Installation Instructions

### Quick Setup (Recommended)

Use the automated setup script:

```bash
cd python
./setup_environments.sh
```

This creates both virtual environments with all dependencies.

### Manual Installation

#### WhisperX Environment

```bash
# Create virtual environment
python3.12 -m venv venv-whisperx

# Activate (Unix/macOS)
source venv-whisperx/bin/activate
# Or on Windows: venv-whisperx\Scripts\activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements-whisperx.txt
pip install -r requirements-common.txt
```

#### Pyannote Environment

```bash
# Create virtual environment
python3.12 -m venv venv-pyannote

# Activate (Unix/macOS)
source venv-pyannote/bin/activate
# Or on Windows: venv-pyannote\Scripts\activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements-pyannote.txt
pip install -r requirements-common.txt

# Set HuggingFace token for model access
export HF_TOKEN=your_token_here
```

### Using Lockfiles for Exact Reproducibility

For CI/CD or production deployments:

```bash
# WhisperX
pip install -r requirements-whisperx.lock

# Pyannote
pip install -r requirements-pyannote.lock
```

## Conflict Resolution Strategies

### Strategy 1: Dual Virtual Environments (Current)

**Approach**: Maintain two separate Python environments with different PyTorch versions.

**Pros**:
- Complete isolation of conflicting dependencies
- Each pipeline gets optimal package versions
- No runtime conflicts

**Cons**:
- Increased disk space (~4-6GB per environment)
- Complexity in environment management
- Need to switch environments for different operations

**Implementation**: The `dualPythonEnvironment.ts` service automatically selects the correct environment based on the operation type (transcription vs diarization).

### Strategy 2: Runtime Patching (Legacy)

**Approach**: Patch `huggingface_hub` to use `weights_only=False` when loading pyannote models.

**Location**: `python/hooks/runtime_hook_torch.py`

**Cons**: Fragile, may break with library updates.

### Strategy 3: Model Re-serialization (Future)

**Approach**: Re-save pyannote models with torch 2.8+ compatible format.

**Status**: Not yet implemented; requires upstream changes or local model conversion.

## Validation

Run the validation script to check for conflicts:

```bash
python validate_requirements.py
```

This script:
- Verifies version constraints are satisfied
- Detects dependency conflicts
- Warns about incompatibilities
- Validates environment isolation

## Troubleshooting

### "torch version mismatch" Error

**Symptom**: Pyannote crashes with tensor loading errors.

**Cause**: Wrong virtual environment activated.

**Solution**: Ensure you're using `venv-pyannote` for diarization and `venv-whisperx` for transcription.

### "numpy.core.multiarray" Import Error

**Symptom**: WhisperX/librosa fails to import.

**Cause**: NumPy 2.0+ installed in whisperx environment.

**Solution**:
```bash
source venv-whisperx/bin/activate
pip install "numpy<2.0"
```

### "No module named 'pyannote.audio'" Error

**Symptom**: Diarization fails to start.

**Cause**: HuggingFace token not configured or model terms not accepted.

**Solution**:
1. Create account at https://huggingface.co
2. Accept model terms at https://huggingface.co/pyannote/speaker-diarization-3.1
3. Create access token at https://huggingface.co/settings/tokens
4. Set `export HF_TOKEN=your_token_here`

### "CUDA out of memory" Error

**Symptom**: Model loading fails on GPU.

**Solution**: The app automatically falls back to CPU mode if CUDA is unavailable or runs out of memory.

## CI/CD Integration

Both environments are tested in CI/CD:

```yaml
# .github/workflows/requirements-validation.yml
- name: Validate WhisperX Environment
  run: |
    python -m venv venv-whisperx
    source venv-whisperx/bin/activate
    pip install -r requirements-whisperx.txt
    python -c "import whisperx; import torch; assert torch.__version__.startswith('2.8')"

- name: Validate Pyannote Environment
  run: |
    python -m venv venv-pyannote
    source venv-pyannote/bin/activate
    pip install -r requirements-pyannote.txt
    python -c "import pyannote.audio; import torch; assert torch.__version__.startswith('2.5')"
```

## Updating Dependencies

See `UPGRADE_GUIDE.md` for instructions on updating dependencies safely.

### Quick Reference

1. **Update requirements file** with new version
2. **Run validation**: `python validate_requirements.py --check-updates`
3. **Test in isolation**: Create fresh venv and install
4. **Regenerate lockfile**: `pip freeze > requirements-<env>.lock`
5. **Run full test suite**: `npm run test:production`

## Files Reference

| File | Purpose |
|------|---------|
| `requirements-whisperx.txt` | WhisperX transcription dependencies |
| `requirements-pyannote.txt` | Pyannote diarization dependencies |
| `requirements-common.txt` | Shared utilities |
| `requirements-whisperx.lock` | Pinned versions for WhisperX |
| `requirements-pyannote.lock` | Pinned versions for Pyannote |
| `validate_requirements.py` | Conflict detection and validation |
| `setup_environments.sh` | Automated environment setup |
| `check_setup.py` | Environment verification |
| `.env.json` | Environment metadata (auto-generated) |

## Architecture Decision Record

**Decision**: Use dual virtual environments instead of unified requirements.

**Context**: WhisperX and Pyannote require incompatible PyTorch versions due to changes in torch.load() default behavior.

**Consequences**:
- Increased complexity in environment management
- Higher disk space requirements
- Need for environment routing logic in Electron services
- Clean separation of concerns
- Each pipeline gets optimal performance

**Date**: 2024
**Status**: Accepted and implemented
