# Meeting Notes - Dependency Upgrade Guide

This guide explains how to safely update Python dependencies while maintaining compatibility between the WhisperX and Pyannote environments.

## Table of Contents

1. [Before You Start](#before-you-start)
2. [Upgrading Individual Packages](#upgrading-individual-packages)
3. [Upgrading PyTorch](#upgrading-pytorch)
4. [Regenerating Lockfiles](#regenerating-lockfiles)
5. [Testing Changes](#testing-changes)
6. [Rollback Procedures](#rollback-procedures)
7. [Common Upgrade Scenarios](#common-upgrade-scenarios)

## Before You Start

### Prerequisites

1. **Backup existing environments** (optional but recommended):
   ```bash
   cp -r venv-whisperx venv-whisperx.backup
   cp -r venv-pyannote venv-pyannote.backup
   ```

2. **Check current versions**:
   ```bash
   source venv-whisperx/bin/activate
   pip list | grep -E "torch|whisperx|numpy"

   source venv-pyannote/bin/activate
   pip list | grep -E "torch|pyannote|speechbrain"
   ```

3. **Run validation** to confirm current state:
   ```bash
   python validate_requirements.py
   ```

### Understanding the Split Requirements

| File | Purpose | Critical Constraints |
|------|---------|---------------------|
| `requirements-whisperx.txt` | Transcription | `torch==2.8.0`, `numpy<2.0` |
| `requirements-pyannote.txt` | Diarization | `torch==2.5.1`, `pytorch-lightning==2.6.0` |
| `requirements-common.txt` | Shared utilities | Version-agnostic |

## Upgrading Individual Packages

### Step 1: Identify the Package

Determine which requirements file contains the package:

```bash
grep -l "packagename" requirements-*.txt
```

### Step 2: Check Compatibility

Before upgrading, check if the new version is compatible:

```bash
# Create a test environment
python -m venv venv-test
source venv-test/bin/activate
pip install package==new_version

# Check for conflicts
pip check
```

### Step 3: Update Requirements File

Edit the appropriate requirements file:

```bash
# Example: Update transformers in whisperx environment
# Edit requirements-whisperx.txt
# Change: transformers>=4.40
# To:     transformers>=4.45
```

### Step 4: Test Installation

```bash
# Recreate environment
rm -rf venv-whisperx
python -m venv venv-whisperx
source venv-whisperx/bin/activate
pip install -r requirements-whisperx.txt
pip install -r requirements-common.txt

# Run import tests
python -c "import whisperx; import torch; print('Success')"
```

### Step 5: Validate

```bash
python validate_requirements.py --strict
```

### Step 6: Update Lockfile

```bash
pip freeze > requirements-whisperx.lock
```

## Upgrading PyTorch

**⚠️ CAUTION**: PyTorch upgrades require careful consideration due to the version conflict between WhisperX and Pyannote.

### WhisperX Environment (torch 2.8.x)

1. **Check WhisperX compatibility**:
   - Visit https://github.com/m-bain/whisperX/releases
   - Check which PyTorch versions are supported

2. **Update requirements-whisperx.txt**:
   ```
   torch==2.9.0  # New version
   torchaudio==2.9.0  # Must match torch major.minor
   ```

3. **Test thoroughly**:
   ```bash
   source venv-whisperx/bin/activate
   python -c "
   import torch
   import whisperx

   # Test basic functionality
   print(f'torch: {torch.__version__}')
   print(f'CUDA: {torch.cuda.is_available()}')
   "
   ```

### Pyannote Environment (torch 2.5.x)

**Note**: Pyannote has stricter PyTorch requirements due to model serialization.

1. **Check pyannote.audio compatibility**:
   - Visit https://github.com/pyannote/pyannote-audio/releases
   - Look for notes about PyTorch version requirements

2. **Test model loading**:
   ```bash
   source venv-pyannote/bin/activate
   python -c "
   from pyannote.audio import Pipeline
   import torch

   print(f'torch: {torch.__version__}')

   # This will fail if torch version is incompatible
   # pipeline = Pipeline.from_pretrained('pyannote/speaker-diarization-3.1')
   "
   ```

3. **Check for weights_only issues**:
   - PyTorch 2.6+ defaults to `weights_only=True`
   - Pyannote models may require `weights_only=False`
   - If upgrading, test model loading carefully

## Regenerating Lockfiles

Lockfiles ensure reproducible installations. Regenerate after any change:

### WhisperX Lockfile

```bash
# Fresh environment
rm -rf venv-whisperx
python -m venv venv-whisperx
source venv-whisperx/bin/activate

# Install from requirements
pip install --upgrade pip
pip install -r requirements-whisperx.txt
pip install -r requirements-common.txt

# Generate lockfile
pip freeze > requirements-whisperx.lock

# Verify
head -50 requirements-whisperx.lock
```

### Pyannote Lockfile

```bash
# Fresh environment
rm -rf venv-pyannote
python -m venv venv-pyannote
source venv-pyannote/bin/activate

# Install from requirements
pip install --upgrade pip
pip install -r requirements-pyannote.txt
pip install -r requirements-common.txt

# Generate lockfile
pip freeze > requirements-pyannote.lock

# Verify
head -50 requirements-pyannote.lock
```

## Testing Changes

### Local Testing

1. **Run validation script**:
   ```bash
   python validate_requirements.py --strict
   ```

2. **Test imports**:
   ```bash
   # WhisperX
   source venv-whisperx/bin/activate
   python -c "
   import whisperx
   import faster_whisper
   import torch
   import torchaudio
   import librosa
   import numpy
   print('WhisperX imports OK')
   "

   # Pyannote
   source venv-pyannote/bin/activate
   python -c "
   import pyannote.audio
   import speechbrain
   import torch
   import torchaudio
   print('Pyannote imports OK')
   "
   ```

3. **Run application tests**:
   ```bash
   npm run test:production
   ```

### CI/CD Testing

Push changes to trigger the requirements validation workflow:

```bash
git add python/requirements-*.txt python/requirements-*.lock
git commit -m "Update dependencies"
git push
```

The workflow will:
- Validate requirements syntax
- Test WhisperX installation on Ubuntu and macOS
- Test Pyannote installation on Ubuntu and macOS
- Verify critical package versions

## Rollback Procedures

### Quick Rollback (Lockfiles)

If something breaks, restore from lockfiles:

```bash
# WhisperX
rm -rf venv-whisperx
python -m venv venv-whisperx
source venv-whisperx/bin/activate
pip install -r requirements-whisperx.lock

# Pyannote
rm -rf venv-pyannote
python -m venv venv-pyannote
source venv-pyannote/bin/activate
pip install -r requirements-pyannote.lock
```

### Git Rollback

Revert to previous requirements:

```bash
git checkout HEAD~1 -- python/requirements-whisperx.txt
git checkout HEAD~1 -- python/requirements-pyannote.txt
```

### Backup Restoration

If you created backups:

```bash
rm -rf venv-whisperx
mv venv-whisperx.backup venv-whisperx
```

## Common Upgrade Scenarios

### Scenario 1: Security Update for requests

```bash
# Check current version
pip show requests

# Update in requirements-common.txt (used by both)
# requests>=2.32.0

# Test in both environments
for env in venv-whisperx venv-pyannote; do
    source $env/bin/activate
    pip install -r requirements-common.txt
    python -c "import requests; print(requests.__version__)"
done
```

### Scenario 2: New WhisperX Release

```bash
# 1. Check release notes
# https://github.com/m-bain/whisperX/releases

# 2. Update requirements-whisperx.txt
# whisperx>=3.2.0

# 3. Test in fresh environment
rm -rf venv-test
python -m venv venv-test
source venv-test/bin/activate
pip install -r requirements-whisperx.txt

# 4. Run transcription test
python -c "import whisperx; print(getattr(whisperx, '__version__', 'installed'))"

# 5. If successful, update real environment
rm -rf venv-whisperx
python -m venv venv-whisperx
source venv-whisperx/bin/activate
pip install -r requirements-whisperx.txt
pip freeze > requirements-whisperx.lock
```

### Scenario 3: Pyannote Model Update

```bash
# Pyannote models are tied to specific versions
# Check model requirements before updating

# 1. Check current model compatibility
python -c "
from huggingface_hub import model_info
info = model_info('pyannote/speaker-diarization-3.1')
print(info.cardData)
"

# 2. If updating pyannote.audio version
# Be prepared to re-accept model terms on HuggingFace
```

### Scenario 4: NumPy Update (WhisperX)

**⚠️ WARNING**: NumPy 2.0 is NOT compatible with WhisperX/librosa!

```bash
# WRONG - Don't do this!
# numpy>=2.0

# CORRECT - Keep <2.0 constraint
# numpy<2.0

# If you accidentally installed NumPy 2.0:
source venv-whisperx/bin/activate
pip install "numpy<2.0"
```

## Checklist for Major Updates

- [ ] Read release notes for the package
- [ ] Check dependency compatibility
- [ ] Create backup of existing environment
- [ ] Update requirements file
- [ ] Test in fresh virtual environment
- [ ] Run validation script
- [ ] Run application tests
- [ ] Update lockfile
- [ ] Commit changes
- [ ] Verify CI/CD passes
- [ ] Test in production-like environment

## Getting Help

If you encounter issues:

1. **Check the README_REQUIREMENTS.md** for known conflicts
2. **Run the validation script** with `--json` for detailed output
3. **Check GitHub Issues** for similar problems
4. **Review CI/CD logs** for environment-specific failures

## Version History

| Date | Change | Author |
|------|--------|--------|
| 2024 | Initial split requirements system | - |
| 2024 | Added requirements-common.txt | - |
| 2024 | Added lockfiles for reproducibility | - |
