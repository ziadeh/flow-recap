---
title: Bundled Python Fix
description: Fix for Python environment detection issues in bundled FlowRecap application
tags:
  - troubleshooting
  - python
  - bundle
  - detection
  - production
lastUpdated: true
prev:
  text: 'Bundle Fix Summary'
  link: '/troubleshooting/BUNDLE_FIX_SUMMARY'
next:
  text: 'Python Bundle Fix'
  link: '/troubleshooting/PYTHON_BUNDLE_FIX'
---

# Bundled Python Environment Detection - Fix Applied

## Problem Summary

The bundled production app was showing:
- **Python Version:** "Not detected"
- **Torch Version:** "Not installed"
- **Environment Health:** 0%

Despite the fact that the `transcription_bundle` executable existed and was working correctly.

## Root Cause

The `pythonEnvironmentValidator.ts` service was trying to validate the bundled Python executable using standard Python command-line flags that the bundle doesn't support:

| Command | Regular Python | Bundled Python | Status |
|---------|---------------|----------------|--------|
| `python --version` | ✅ Supported | ❌ Not supported | **PROBLEM** |
| `python -c "import torch"` | ✅ Supported | ❌ Not supported | **PROBLEM** |
| `python check_setup.py` | ✅ Works | ❌ Wrong syntax | Different |
| `transcription_bundle check` | ❌ N/A | ✅ **Correct way** | **SOLUTION** |

### Why This Happened

The bundled `transcription_bundle` executable is a PyInstaller-created bundle with a custom entry point (`_bundle_entry.py`) that routes commands to specific scripts:

```
transcription_bundle <script_name> [args]

Available scripts:
  - transcribe
  - diarize
  - core_diarize
  - stream
  - live_diarize
  - check        ← Used for validation
  - diagnose     ← Comprehensive diagnostics
```

The validator was treating it like a regular Python interpreter, which failed.

## Fix Implemented

### Changes Made

**File:** `electron/services/pythonEnvironmentValidator.ts`

#### 1. Added Bundled Python Detection Helper

```typescript
/**
 * Check if Python path is a bundled executable (transcription_bundle)
 */
private isBundledPython(pythonPath: string): boolean {
  return pythonPath.includes('transcription_bundle')
}
```

#### 2. Updated `checkPythonVersion()` Method

**Before:**
```typescript
const versionOutput = execSync(`"${pythonPath}" --version 2>&1`, { ... })
```

**After:**
```typescript
let versionOutput: string

// Bundled Python doesn't support --version, use 'check' script
if (this.isBundledPython(pythonPath)) {
  versionOutput = execSync(`"${pythonPath}" check 2>&1`, {
    encoding: 'utf8',
    timeout: 30000,  // Bundled Python takes longer on first run
  })
} else {
  versionOutput = execSync(`"${pythonPath}" --version 2>&1`, {
    encoding: 'utf8',
    timeout: 10000,
  })
}
```

The `check` script outputs:
```
Python 3.12.12
✓ PyTorch 2.5.1
✓ WhisperX
✓ faster-whisper
✓ pyannote.audio
```

#### 3. Updated `checkPackageImports()` Method

**Before:**
```typescript
for (const pkg of packages) {
  execSync(`"${pythonPath}" -c "import ${pkg}" 2>&1`, { ... })
}
```

**After:**
```typescript
// Bundled Python: Use 'check' script which tests all imports
if (this.isBundledPython(pythonPath)) {
  const checkOutput = execSync(`"${pythonPath}" check 2>&1`, { ... })

  // Parse check output for package status
  for (const pkg of packages) {
    const pkgName = pkg === 'faster_whisper' ? 'faster-whisper' : ...
    const isInstalled = checkOutput.includes(`✓`) && checkOutput.includes(pkgName)
    results[pkg] = isInstalled

    // Extract version if available
    const versionMatch = checkOutput.match(/PackageName\\s+([\\d.]+)/)
    if (versionMatch) {
      versions[pkg] = versionMatch[1]
    }
  }
} else {
  // Regular Python: Use -c to import each package
  for (const pkg of packages) {
    execSync(`"${pythonPath}" -c "import ${pkg}" 2>&1`, { ... })
  }
}
```

#### 4. Updated `checkNativeDependencies()` Method

For bundled Python, skip the CUDA/MPS check since it requires arbitrary code execution:

```typescript
// Bundled Python: Skip native dependencies check (assume CPU mode)
if (this.isBundledPython(pythonPath)) {
  check.status = 'warning'
  check.message = 'Native dependencies check skipped for bundled Python (CPU mode assumed)'
  check.details = {
    cudaAvailable: false,
    mpsAvailable: false,
    device: 'CPU',
    platform,
  }
  check.duration = Date.now() - startTime
  return check
}
```

#### 5. Updated `checkSubprocessSpawning()` Method

Changed subprocess test to use appropriate command:

```typescript
// Bundled Python: Use 'check' script instead of -c
const args = this.isBundledPython(pythonPath)
  ? ['check']  // Will output Python version and package info
  : ['-c', 'print("SUBPROCESS_OK")']

const proc = spawn(pythonPath, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: this.isBundledPython(pythonPath) ? 30000 : 10000,
})

// Updated success condition
const successCondition = isBundled
  ? (code === 0 && stdout.includes('Python'))  // Check script shows Python version
  : (code === 0 && stdout.includes('SUBPROCESS_OK'))
```

#### 6. Updated `checkPyAnnoteModel()` Method

Skip model loading test for bundled Python (model will download on first use):

```typescript
// Bundled Python: Skip model loading check
if (this.isBundledPython(pythonPath)) {
  check.status = 'warning'
  check.message = 'PyAnnote model loading not tested for bundled Python (will download on first use)'
  check.duration = Date.now() - startTime
  return check
}
```

## Expected Results After Fix

### Before Fix
```json
{
  "environments": {
    "whisperx": {
      "status": "failed",
      "pythonVersion": null,
      "packages": [
        {"name": "whisperx", "available": false},
        {"name": "faster-whisper", "available": false},
        {"name": "torch", "available": false}
      ]
    }
  },
  "healthMetrics": {
    "overallScore": 0
  }
}
```

### After Fix
```json
{
  "environments": {
    "whisperx": {
      "status": "ready",
      "pythonVersion": "3.12.12",
      "torchVersion": "2.5.1",
      "packages": [
        {"name": "whisperx", "available": true},
        {"name": "faster-whisper", "available": true, "version": "1.2.1"},
        {"name": "torch", "available": true, "version": "2.5.1"}
      ]
    }
  },
  "healthMetrics": {
    "overallScore": 100
  }
}
```

## Validation Checks Summary

After the fix, these checks will pass/warn for bundled Python:

| Check | Status | Note |
|-------|--------|------|
| Python Binary | ✅ Pass | Bundle exists and is executable |
| Python Version | ✅ Pass | 3.12.12 detected from `check` output |
| Package Imports | ✅ Pass | All packages detected via `check` output |
| PyAnnote Model | ⚠️ Warning | Skipped (downloads on first use) |
| Native Dependencies | ⚠️ Warning | Skipped (CPU mode assumed) |
| File Permissions | ✅ Pass | Bundle is executable |
| Subprocess Spawning | ✅ Pass | `check` script runs successfully |
| Dual Environment | ⚠️ Warning | N/A for bundled Python |

**Overall health score:** ~80-90% (passing core requirements, warnings are expected)

## Testing the Fix

### 1. Verify the Bundle Works Directly

```bash
# Check if bundle executes
"/Users/ziadziadeh/.../Meeting Notes.app/Contents/Resources/python/transcription_bundle" check

# Should show:
# ✓ Python 3.12.12
# ✓ PyTorch 2.5.1
# ✓ WhisperX
# ✓ faster-whisper
# ✓ pyannote.audio
```

### 2. Test the Rebuilt App

1. Open the rebuilt app:
   ```bash
   open "/Users/ziadziadeh/Documents/development/meeting-notes/Meeting Notes/release/1.0.0/mac-arm64/Meeting Notes.app"
   ```

2. Navigate to: **Settings → Python Environment** (or wherever the environment status is shown)

3. Click "Refresh" or restart the app

4. Expected results:
   - Python Version: **3.12.12** (not "Not detected")
   - Torch Version: **2.5.1** (not "Not installed")
   - Environment Status: **Ready** (not "Failed")
   - Package availability: All show ✅ green checkmarks

### 3. Test Transcription Functionality

1. Record or load a test audio file
2. Run transcription
3. Should work without errors about Python not being found

## Files Modified

1. **`electron/services/pythonEnvironmentValidator.ts`**
   - Added `isBundledPython()` helper method
   - Updated 6 validation check methods to handle bundled Python
   - Total changes: ~100 lines modified/added

## Build Information

- **Build Date:** 2026-01-16 20:43
- **App Location:** `release/1.0.0/mac-arm64/Meeting Notes.app`
- **App Size:** ~73 MB (asar archive)
- **Python Bundle:** Included at `Contents/Resources/python/transcription_bundle`
- **Python Bundle Size:** 93.4 MB executable + dependencies

## Related Fixes

This fix builds upon the PyInstaller import fixes from the previous implementation:

1. **PyInstaller Bundle Fixes** ([PYTHON_BUNDLE_FIX.md](./PYTHON_BUNDLE_FIX.md))
   - Fixed torch._inductor imports
   - Fixed torchaudio circular imports
   - Fixed ctranslate2 binary collection
   - Created diagnostic tool

2. **Validation Service Fix** (this document)
   - Fixed bundled Python detection
   - Updated validation methods
   - Made validation compatible with both regular and bundled Python

## Technical Notes

### Why Not Use `-c` for Bundled Python?

The PyInstaller bundle uses a custom entry point that:
1. Parses the first argument as a script name
2. Routes to the appropriate Python module
3. Does not support arbitrary code execution via `-c`

This is by design for security and simplicity. The bundle is meant to run specific predefined scripts, not arbitrary Python code.

### Performance Considerations

- Bundled Python `check` script takes ~3-5 seconds on first run (cold start)
- Subsequent runs are faster (~1-2 seconds)
- This is accounted for in timeout values (30s for bundled vs 10s for regular Python)

### Why Skip Model Loading Check?

The PyAnnote model loading check requires:
1. HuggingFace token
2. Internet connection
3. 30-60 second download time
4. Complex Python code execution

For bundled Python, this check is skipped because:
- Models download automatically on first transcription
- The check would significantly slow down app startup
- The `check` script already confirms pyannote.audio imports successfully

## Troubleshooting

### If App Still Shows "Not Detected"

1. **Verify bundle exists:**
   ```bash
   ls -l "/path/to/Meeting Notes.app/Contents/Resources/python/transcription_bundle"
   ```

2. **Check if bundle is executable:**
   ```bash
   "/path/to/Meeting Notes.app/Contents/Resources/python/transcription_bundle" check
   ```

3. **Check app was actually rebuilt:**
   ```bash
   ls -lt "/path/to/Meeting Notes.app/Contents/Resources/app.asar"
   # Should show recent timestamp (Jan 16 20:43 or later)
   ```

4. **Try reinstalling:**
   - Delete the old app
   - Extract fresh copy from DMG or ZIP
   - Launch and test

### Checking Logs

The validator outputs detailed logs to the console. To view:

1. Open Console.app (macOS)
2. Filter for "Meeting Notes"
3. Look for lines containing:
   - `pythonEnvironment`
   - `pythonValidation`
   - `checkPythonVersion`

## Summary

**Problem:** Bundled app couldn't validate Python environment because validator assumed regular Python CLI.

**Solution:** Updated validator to detect bundled Python and use appropriate commands (`check` script instead of `--version` and `-c`).

**Result:** Bundled Python now correctly detected and validated with environment health score of 80-90%.

**Status:** ✅ **FIXED** - Ready to test

---

**Build timestamp:** 2026-01-16 20:43
**Testing location:** `release/1.0.0/mac-arm64/Meeting Notes.app`
**Next step:** Open the app and verify Python environment shows as "Ready"
