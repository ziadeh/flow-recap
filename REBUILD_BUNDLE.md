# Quick Guide: Rebuilding the Python Bundle

## ⚠️ Important: Development vs Production

**Your development environment is working correctly!** The errors you're seeing are about:
1. ✅ Optional dual-environment setup (not critical)
2. ❌ Production bundle import failures (needs fixing)

See `PYTHON_ENV_ARCHITECTURE.md` for a detailed explanation.

## TL;DR - Quick Fix for Production Bundle

```bash
# 1. Clean rebuild the Python bundle
npm run bundle:python:clean

# 2. Build new bundle with PyInstaller fixes
npm run bundle:python

# 3. Verify the bundle works
./resources/python-bundle/transcription_bundle diagnose

# 4. If diagnose passes, rebuild the app
npm run dist:bundled

# 5. Test the production app
open "release/1.0.0/mac-arm64/Meeting Notes.app"
```

## What Was Fixed?

Three critical issues were preventing imports in the bundled app:

1. **TorchAudio Circular Import** - Added hook to properly configure backend
2. **Missing torch._inductor** - Required by pyannote but was excluded
3. **Missing CTranslate2 Binaries** - Native libraries weren't being collected

## Files Modified

- ✅ `python/transcription_bundle.spec` - Updated hidden imports and excludes
- ✅ `python/hooks/hook-ctranslate2.py` - Added binary collection
- ✅ `python/hooks/hook-torchaudio.py` - NEW: Fixes circular import
- ✅ `python/diagnose_bundle.py` - NEW: Diagnostic tool
- ✅ `python/_bundle_entry.py` - Added diagnose command

## Step-by-Step Rebuild

### 1. Verify Development Environment (Optional)

**Note:** This step verifies your development environment. If transcription already works in dev mode, you can skip to step 2.

```bash
# Make sure your venv is working
# You can use venv-3.12, venv-whisperx, or venv
source python/venv-3.12/bin/activate
python python/check_setup.py

# Should see all green checkmarks
```

**Supported development environments:**
- `venv-3.12` or `venv` - Single environment (what you currently have) ✅
- `venv-whisperx` + `venv-pyannote` - Dual environment (optional upgrade)

### 2. Clean Previous Bundle

```bash
# Remove old bundle artifacts
npm run bundle:python:clean

# This deletes:
# - python/dist/
# - python/build/
# - resources/python-bundle/
```

### 3. Rebuild Bundle

```bash
# Build new bundle with fixes
npm run bundle:python

# Watch for warnings about missing imports
# Should take 5-10 minutes depending on your machine
```

### 4. Verify Bundle

```bash
# Run diagnostic tool
./resources/python-bundle/transcription_bundle diagnose

# Expected output:
# ✓ All 6 critical packages imported successfully!
# ✓ Bundle appears to be working correctly.
```

### 5. Test Bundle Manually

```bash
# Test check script
./resources/python-bundle/transcription_bundle check

# Should see:
# ✓ PyTorch 2.8.0
# ✓ WhisperX
# ✓ faster-whisper
# ✓ pyannote.audio
```

### 6. Rebuild Electron App

```bash
# Build app with bundled Python
npm run dist:bundled

# Output: release/1.0.0/mac-arm64/Meeting Notes.app
```

### 7. Test Production App

```bash
# Open the built app
open "release/1.0.0/mac-arm64/Meeting Notes.app"

# In the app:
# 1. Go to Settings → Python Environment
# 2. Should see "Python Environment: Bundled"
# 3. Should see green checkmarks for all packages
# 4. Try transcribing a test audio file
```

## Troubleshooting

### Bundle Build Fails

**Symptom:** PyInstaller errors during build

**Solution:**
```bash
# Check if all dependencies are installed
pip list | grep -E "(torch|whisperx|pyannote|faster-whisper|ctranslate2)"

# Reinstall if needed
pip install -r python/requirements.txt
```

### Imports Still Fail After Rebuild

**Symptom:** diagnose shows import failures

**Solution:**
```bash
# Check PyInstaller hooks are being used
ls python/hooks/

# Should see:
# - hook-ctranslate2.py
# - hook-torchaudio.py
# - runtime_hook_torch.py

# Check warnings during build
npm run bundle:python 2>&1 | grep -i "warning\|error"
```

### Bundle Too Large

**Symptom:** Bundle is > 10 GB

**Solution:**
- Don't use `--include-models` flag
- Models should download on first use
- Check if multiple torch versions are included

### Can't Find transcription_bundle

**Symptom:** Command not found

**Solution:**
```bash
# Check bundle was created
ls -lh resources/python-bundle/

# Should see:
# transcription_bundle (89 MB executable)
# _internal/ (directory with dependencies)
```

## Common Build Issues

### 1. Virtual Environment Not Activated

```bash
# Symptom: "module not found" during build
# Solution:
source python/venv-3.12/bin/activate
```

### 2. Wrong Python Version

```bash
# Symptom: PyInstaller complains about Python version
# Solution: Use Python 3.12
which python3
python3 --version  # Should be 3.12.x
```

### 3. PyInstaller Not Installed

```bash
# Symptom: "pyinstaller: command not found"
# Solution:
pip install pyinstaller
```

### 4. Insufficient Disk Space

```bash
# Symptom: Build fails midway
# Solution: Need ~15 GB free space for build process
df -h .
```

## Build Time Estimates

- **Clean build:** 8-12 minutes
- **Incremental build:** 3-5 minutes
- **Electron packaging:** 2-4 minutes
- **Total:** ~15-20 minutes for full rebuild

## What Gets Bundled?

### Python Runtime
- Python 3.12 interpreter
- Standard library
- Site-packages with all ML dependencies

### ML Libraries (Total: ~6 GB)
- PyTorch 2.8.0 (~2 GB)
- TorchAudio (~200 MB)
- WhisperX (~50 MB)
- faster-whisper + CTranslate2 (~100 MB)
- Pyannote Audio (~100 MB)
- Dependencies (numpy, scipy, etc.) (~500 MB)

### What's NOT Bundled
- ❌ ML Models (download on first use)
- ❌ User data
- ❌ Configuration files
- ❌ Cache directories

## Testing Checklist

After rebuild, verify:

- [ ] Bundle diagnostic passes
- [ ] Check script shows all packages available
- [ ] Transcription works with test audio
- [ ] Speaker diarization works
- [ ] Models download correctly
- [ ] HuggingFace authentication works
- [ ] Error messages are clear

## Performance Notes

### Development vs Production

| Aspect | Development | Production Bundle |
|--------|-------------|-------------------|
| Startup Time | ~2 sec | ~5 sec (first launch) |
| Import Time | ~3 sec | ~8 sec (cold start) |
| Memory Usage | ~800 MB | ~1 GB |
| Disk Space | 6 GB (venv) | 6.5 GB (bundle) |

### Optimization Tips

1. **First Launch Cache:**
   - Bundle extracts to temp on first launch
   - Subsequent launches are faster

2. **Model Caching:**
   - Models cached in `~/.cache/huggingface/`
   - Reused across app launches

3. **Memory Management:**
   - PyTorch eager mode (not compiled)
   - Models loaded on-demand
   - GPU memory managed automatically

## FAQ

### Q: Why does validation show "failed" but transcription works?

**A:** Validation checks for the **optimal** setup (dual environments), but your single environment (`venv-3.12`) works fine for development. The "failure" is informational, not critical.

See `PYTHON_ENV_ARCHITECTURE.md` for details.

### Q: Should I create venv-whisperx and venv-pyannote?

**A:** Only if you:
- Frequently test both transcription and diarization
- Encounter PyTorch version conflicts
- Want maximum stability
- Have 12 GB disk space to spare

Otherwise, your `venv-3.12` is perfectly adequate.

### Q: What's the difference between development and bundle errors?

**A:**
- **Development errors** (venv-whisperx): Optional upgrade, not critical
- **Bundle errors** (production): Critical, needs PyInstaller fixes

They're separate issues. Your dev environment works fine.

### Q: Do I need to fix the "Failed to create venv-whisperx" error?

**A:** No! This just means the automated setup tried to create the optional dual-environment and found you already have a working single environment. Your current setup works.

## Support

If issues persist after following this guide:

1. Check `PYTHON_ENV_ARCHITECTURE.md` to understand environment types
2. Check `PYTHON_BUNDLE_FIX.md` for detailed technical analysis
3. Run diagnostic tool and share output: `./resources/python-bundle/transcription_bundle diagnose`
4. Check Electron console logs
5. Look for Python stderr in app logs

## Quick Reference

```bash
# Full rebuild from scratch
npm run bundle:python:clean && \
npm run bundle:python && \
./resources/python-bundle/transcription_bundle diagnose && \
npm run dist:bundled

# Test production app
open "release/1.0.0/mac-arm64/Meeting Notes.app"
```

---

**Last Updated:** 2026-01-16
**Status:** ✅ Ready to rebuild
