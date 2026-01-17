# PyInstaller Bundle Troubleshooting Guide

## Issue: TorchAudio Circular Import Error

### Symptoms

When running the bundled executable (`transcription_bundle`), you see errors like:

```
Checking torchaudio...
  NOT INSTALLED: cannot import name 'sox_io_backend' from partially initialized module 'torchaudio.backend'
  (most likely due to a circular import)

Checking pyannote.audio...
  NOT INSTALLED: cannot import name 'sox_io_backend' from partially initialized module 'torchaudio.backend'
  (most likely due to a circular import)
```

### Root Cause

**The Problem**: TorchAudio tries to auto-detect available backends (SoX and SoundFile) when imported. The SoX backend (`torchaudio.backend.sox_io_backend`) has many complex dependencies and is intentionally excluded from the PyInstaller bundle to reduce size and complexity.

**Why It Fails**: When torchaudio's initialization code tries to import the excluded SoX backend, Python sees a partially initialized `torchaudio.backend` module and raises a circular import error.

### Solution Implemented

We've implemented a **three-layer defense** against this issue:

#### 1. Runtime Hook Patching (`python/hooks/runtime_hook_torch.py`)

This hook runs **BEFORE** any application code and:

- **Sets `TORCHAUDIO_BACKEND=soundfile`** environment variable to tell torchaudio to use only the soundfile backend
- **Creates fake stub modules** for `sox_io_backend` and `sox_backend` in `sys.modules` to prevent import errors if something still tries to import them

```python
# Set environment variable BEFORE any torchaudio imports
os.environ['TORCHAUDIO_BACKEND'] = 'soundfile'

# Create fake modules to intercept import attempts
sys.modules['torchaudio.backend.sox_io_backend'] = fake_sox_backend
sys.modules['torchaudio.backend.sox_backend'] = fake_sox_backend
```

#### 2. PyInstaller Hook Filtering (`python/hooks/hook-torchaudio.py`)

This hook modifies how PyInstaller collects torchaudio modules:

- **Filters out all SoX-related submodules** during the collection phase
- **Explicitly includes only soundfile backend modules**

```python
# Exclude any modules with 'sox' in the name
hiddenimports = [m for m in collect_submodules('torchaudio')
                 if 'sox' not in m.lower()]
```

#### 3. Spec File Exclusions (`python/transcription_bundle.spec`)

The PyInstaller spec file explicitly excludes SoX backends:

```python
excludes = [
    # ...
    'torchaudio.backend.sox_backend',
    'torchaudio.backend.sox_io_backend',
]
```

### How to Rebuild the Bundle with the Fix

After making changes to the hooks or spec file, rebuild the bundle:

```bash
# From the project root
cd "Meeting Notes"

# Clean previous build (recommended)
npm run bundle:python:clean

# Build new bundle with updated hooks
npm run bundle:python

# Verify the fix
./python/dist/transcription_bundle/transcription_bundle check
```

### Verification

After rebuilding, run the check command. You should see:

```
[Runtime Hook] torch.load patched to use weights_only=False by default
[Runtime Hook] Set TORCHAUDIO_BACKEND=soundfile to avoid SoX circular imports
[Runtime Hook] Created fake sox_io_backend module to prevent import errors

============================================================
  Meeting Notes - Python Setup Verification
============================================================

Checking torchaudio...
  ✓ torchaudio 2.5.1

Checking pyannote.audio...
  ✓ pyannote.audio 3.3.2
```

### Why We Use SoundFile Instead of SoX

| Feature | SoundFile | SoX |
|---------|-----------|-----|
| **Dependencies** | libsndfile (simple) | libsox + many codec libraries |
| **Bundling** | Easy - single library | Complex - many external deps |
| **Format Support** | WAV, FLAC, OGG, etc. | More formats, but unnecessary |
| **Transcription** | ✅ All needed formats | ❌ Overkill |
| **Diarization** | ✅ Works perfectly | ❌ Not needed |

For Meeting Notes, SoundFile provides everything needed without the complexity.

### Alternative Solutions (NOT Recommended)

#### Option A: Include SoX in Bundle
**Why Not**: Would require bundling libsox and all its dependencies (ffmpeg, lame, mad, flac, etc.), increasing bundle size by 50-100MB and introducing platform-specific binary issues.

#### Option B: Modify torchaudio Source
**Why Not**: Would require forking torchaudio, making updates difficult and breaking compatibility.

#### Option C: Lazy Import Workaround
**Why Not**: The runtime hook approach is cleaner and handles the issue at the root.

### Testing Checklist

After implementing the fix, verify:

- [ ] Bundle builds without errors
- [ ] `transcription_bundle check` shows torchaudio working
- [ ] `transcription_bundle check` shows pyannote.audio working
- [ ] Transcription actually works: `transcription_bundle transcribe test.wav`
- [ ] Diarization actually works: `transcription_bundle diarize test.wav`

### Related Issues

- **PyTorch weights_only Warning**: Also fixed in the same runtime hook
- **Pyannote Model Loading**: Fixed by patching `torch.load` to use `weights_only=False`

### Further Reading

- [PyTorch Audio Backend Documentation](https://pytorch.org/audio/stable/backend.html)
- [PyInstaller Runtime Hooks Guide](https://pyinstaller.org/en/stable/hooks.html#run-time-hooks)
- [TorchAudio SoX Backend Deprecation](https://github.com/pytorch/audio/issues/2950)

---

## Other Common Bundle Issues

### Issue: "No module named 'whisperx'"

**Solution**: Ensure `whisperx` is in the `hiddenimports` list in `transcription_bundle.spec` and that the package is installed in the environment used for bundling.

### Issue: "CUDA not available"

**Expected**: The bundled version uses CPU-only PyTorch to keep bundle size manageable. CUDA support would add 2-3GB to the bundle.

### Issue: Bundle Size Too Large

**Current Size**: ~1.5-2GB (without pre-downloaded models)

**To Reduce**:
- Models are downloaded separately (not bundled by default)
- Use `upx=True` in spec file (already enabled)
- Exclude unnecessary packages in spec file `excludes` list

### Issue: Bundle Crashes on Startup

**Debug Steps**:
1. Run with `--debug` flag to see detailed logs
2. Check runtime hooks executed correctly
3. Verify Python version matches (3.12.12)
4. Check for missing shared libraries (especially on Linux)

---

**Last Updated**: 2025-01-16
**Bundle Version**: 1.0.0
**PyInstaller Version**: 6.0+
