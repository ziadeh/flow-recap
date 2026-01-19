---
title: Python Environment Bundling Guide
description: How to bundle the Python transcription pipeline with FlowRecap for standalone distribution
tags:
  - setup
  - python
  - bundling
  - distribution
  - deployment
lastUpdated: true
prev:
  text: 'Building FlowRecap'
  link: '/setup/BUILD'
next:
  text: 'Python Environment Architecture'
  link: '/setup/PYTHON_ENV_ARCHITECTURE'
---

# Python Environment Bundling Guide

This guide explains how to bundle the Python transcription pipeline with the Meeting Notes application for standalone distribution.

## Overview

The Meeting Notes app uses Python for ML-powered transcription and speaker diarization. There are three ways to provide Python dependencies:

1. **Bundled Python (Recommended for Distribution)** - Standalone executable with all dependencies pre-packaged
2. **Virtual Environment (Development)** - Python venv with pip-installed packages
3. **System Python (Fallback)** - Uses system Python installation

## Quick Start

### For Distribution Builds

```bash
# Build with bundled Python
npm run dist:bundled

# Platform-specific bundled builds
npm run dist:bundled:mac
npm run dist:bundled:win
npm run dist:bundled:linux
```

### For Development

```bash
# Set up Python virtual environment
cd python
python3 -m venv venv-3.12
source venv-3.12/bin/activate  # On macOS/Linux
# or: venv-3.12\Scripts\activate  # On Windows

# Install dependencies
pip install -r requirements.txt

# Run development build (uses venv)
npm run dev
```

## Bundling Process

### Prerequisites

Before bundling Python, ensure you have:

1. **Python 3.10+** installed on your system
2. **Virtual environment** with all dependencies installed
3. **PyInstaller** installed (`pip install pyinstaller`)

### Creating the Bundle

```bash
# Create Python bundle
npm run bundle:python

# Clean and rebuild
npm run bundle:python:clean

# Build and verify
npm run bundle:python:verify

# Include ML models (increases bundle size significantly)
npm run bundle:python:models
```

### Bundle Output

The bundle is created in `resources/python-bundle/` with this structure:

```
resources/python-bundle/
├── transcription_bundle       # Main executable (or .exe on Windows)
├── _internal/                 # PyInstaller runtime and libraries
│   ├── torch/
│   ├── whisperx/
│   ├── pyannote/
│   └── ...
├── transcribe.py              # Python scripts (for reference)
├── diarize.py
└── ...
```

## Architecture

### Environment Detection Priority

The app detects Python environments in this order:

1. **Bundled executable** (`resources/python/transcription_bundle`)
2. **Virtual environment** (`python/venv-3.12` or `python/venv`)
3. **System Python** (via `PYTHON_PATH` env var or system PATH)

### Script Execution

When running ML scripts, the app:

1. Detects the available Python environment
2. For bundled: Runs `transcription_bundle <command> [args]`
3. For venv/system: Runs `python script.py [args]`

### Bundle Commands

The bundled executable supports these commands:

| Command | Script | Description |
|---------|--------|-------------|
| `transcribe` | `transcribe.py` | Audio transcription |
| `diarize` | `diarize.py` | Speaker diarization |
| `core_diarize` | `core_diarization_engine.py` | Core diarization |
| `stream` | `stream_transcribe.py` | Streaming transcription |
| `live_diarize` | `live_diarize.py` | Live diarization |
| `check` | `check_setup.py` | Environment check |

Example:
```bash
# Using bundle
./transcription_bundle transcribe audio.wav --model large-v2

# Using venv
python transcribe.py audio.wav --model large-v2
```

## Configuration

### electron-builder.config.cjs

The electron-builder config automatically:
- Detects if Python bundle exists
- Includes bundle in distribution if present
- Falls back to including Python scripts only

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PYTHON_PATH` | Override Python executable path |
| `PYINSTALLER_PATH` | Override PyInstaller path |
| `HF_TOKEN` | HuggingFace token for model downloads |

## Bundle Size Considerations

The Python bundle can be large due to ML dependencies:

| Component | Approximate Size |
|-----------|-----------------|
| Python runtime | ~50 MB |
| PyTorch (CPU) | ~500 MB |
| PyTorch (CUDA) | ~2 GB |
| WhisperX | ~100 MB |
| pyannote.audio | ~200 MB |
| Other deps | ~100 MB |
| **Total (CPU)** | **~1 GB** |
| **Total (CUDA)** | **~3 GB** |

### Reducing Bundle Size

1. **Use CPU-only PyTorch** - Significantly smaller, works on all machines
2. **Exclude unused models** - Don't include pre-trained models
3. **Use UPX compression** - Enabled by default in PyInstaller spec

## Troubleshooting

### Bundle creation fails

```bash
# Check Python version
python --version  # Should be 3.10+

# Check PyInstaller
pip install --upgrade pyinstaller

# Clean and rebuild
npm run bundle:python:clean
```

### Bundle doesn't run on target machine

1. Ensure bundle was built for correct platform/architecture
2. Check system dependencies (glibc version on Linux)
3. Verify CUDA compatibility if using GPU

### ML models not loading

1. Models are downloaded on first use
2. Requires internet connection for initial download
3. Set `HF_TOKEN` for gated models (pyannote)

### Script not found errors

1. Ensure Python scripts are in `python/` directory
2. Check that scripts are included in bundle spec
3. Verify script permissions (chmod +x on Unix)

## Development Workflow

### Adding New Python Scripts

1. Add script to `python/` directory
2. Update `SCRIPT_MAP` in `pythonEnvironment.ts`
3. Update `BUNDLE_COMMAND_MAP` in `pythonEnvironment.ts`
4. Add script to `transcription_bundle.spec` main_scripts
5. Rebuild bundle: `npm run bundle:python:clean`

### Updating Dependencies

1. Update `python/requirements.txt`
2. Reinstall in venv: `pip install -r requirements.txt`
3. Rebuild bundle: `npm run bundle:python:clean`
4. Test thoroughly on all platforms

### Testing Bundle

```bash
# Build with verification
npm run bundle:python:verify

# Manual testing
./resources/python-bundle/transcription_bundle check
./resources/python-bundle/transcription_bundle transcribe test.wav
```

## Platform-Specific Notes

### macOS

- Universal binaries (x64 + arm64) require separate builds
- Code signing required for distribution
- Gatekeeper may block unsigned bundles

### Windows

- Bundle creates `.exe` file
- May trigger antivirus false positives
- Code signing recommended

### Linux

- Requires compatible glibc version
- AppImage bundles work best for distribution
- Consider providing .deb/.rpm packages

## Related Files

- `python/transcription_bundle.spec` - PyInstaller specification
- `scripts/bundle-python.js` - Build script
- `electron/services/pythonEnvironment.ts` - Environment detection
- `electron-builder.config.cjs` - Distribution configuration
