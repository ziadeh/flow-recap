---
title: Building FlowRecap
description: Complete guide to building and packaging FlowRecap for macOS, Windows, and Linux platforms
tags:
  - setup
  - build
  - installation
  - npm
  - electron
lastUpdated: true
prev:
  text: 'Introduction'
  link: '/'
next:
  text: 'Python Bundling'
  link: '/setup/PYTHON_BUNDLING'
---

# Building FlowRecap

This document describes how to build and package FlowRecap for different platforms.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Python Bundling](#python-bundling)
- [Build Scripts](#build-scripts)
- [Output](#output)
- [Platform-Specific Requirements](#platform-specific-requirements)
- [Code Signing](#code-signing)
- [Virtual Audio Drivers](#virtual-audio-drivers)
- [Icons](#icons)
- [Continuous Integration](#continuous-integration)
- [Troubleshooting](#troubleshooting)
- [Auto-Updates](#auto-updates)

## Prerequisites

1. Node.js 18+ installed
2. npm or yarn package manager
3. Platform-specific requirements (see below)

**For bundled Python builds (recommended for distribution):**
- Python 3.10+ with pip
- Virtual environment with ML dependencies installed

## Quick Start

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build for current platform (without bundled Python)
npm run dist

# Build with bundled Python (recommended for distribution)
npm run dist:bundled

# Build for specific platforms
npm run dist:mac     # macOS (DMG + ZIP)
npm run dist:win     # Windows (NSIS + ZIP + Portable)
npm run dist:linux   # Linux (AppImage + deb + rpm + snap)
npm run dist:all     # All platforms

# Build with bundled Python for specific platforms
npm run dist:bundled:mac    # macOS with bundled Python
npm run dist:bundled:win    # Windows with bundled Python
npm run dist:bundled:linux  # Linux with bundled Python
```

## Python Bundling

FlowRecap uses Python for ML-based transcription (WhisperX) and speaker diarization (pyannote.audio).
For distribution, the Python environment can be bundled into the app using PyInstaller, eliminating the
need for users to install Python manually.

### Why Bundle Python?

- **Zero Python Setup Required**: Users don't need to install Python or any ML dependencies
- **Consistent Environment**: Guaranteed working configuration across all machines
- **Simplified Distribution**: Single self-contained application bundle
- **No Dependency Conflicts**: Isolated from system Python installations

### Bundle Contents

The bundled Python includes:
- Python interpreter and standard library
- **WhisperX** - Fast speech recognition with word-level timestamps
- **faster-whisper** - Fallback transcription backend
- **pyannote.audio** - Speaker diarization
- **PyTorch & torchaudio** - ML framework
- All required dependencies (~1.5-2 GB total)

**Note**: ML models are NOT included in the bundle by default (they add ~3-5 GB).
Models are downloaded on first use and cached in the user's home directory.

### Building with Bundled Python

```bash
# 1. First, set up the Python environment (one-time setup)
cd python
python3 -m venv venv-3.12
source venv-3.12/bin/activate  # On Windows: venv-3.12\Scripts\activate
pip install -r requirements.txt

# 2. Bundle Python (creates resources/python-bundle/)
npm run bundle:python

# 3. Build the app with bundled Python
npm run dist:bundled
```

### Python Bundle Scripts

| Script | Description |
|--------|-------------|
| `npm run bundle:python` | Create Python bundle for current platform |
| `npm run bundle:python:clean` | Clean and rebuild Python bundle |
| `npm run bundle:python:verify` | Verify bundle works correctly |
| `npm run bundle:python:models` | Bundle with pre-downloaded ML models |
| `npm run dist:bundled` | Full build with Python bundle |
| `npm run dist:bundled:mac` | macOS build with Python bundle |
| `npm run dist:bundled:win` | Windows build with Python bundle |
| `npm run dist:bundled:linux` | Linux build with Python bundle |

### Supported Platforms

| Platform | Architecture | Status |
|----------|--------------|--------|
| macOS | Intel (x64) | ✅ Supported |
| macOS | Apple Silicon (arm64) | ✅ Supported |
| Windows | x64 | ✅ Supported |
| Linux | x64 | ✅ Supported |

### First-Run Model Downloads

When users first use transcription or diarization features, ML models are automatically downloaded:

| Model | Size | Description |
|-------|------|-------------|
| Whisper Large-v2 | ~3 GB | Speech recognition model |
| Pyannote Diarization | ~500 MB | Speaker diarization pipeline |
| Pyannote Segmentation | ~100 MB | Voice activity detection |
| Pyannote Embedding | ~200 MB | Speaker embedding extraction |

Models are cached in:
- **macOS**: `~/.cache/huggingface/`
- **Windows**: `%USERPROFILE%\.cache\huggingface\`
- **Linux**: `~/.cache/huggingface/`

### HuggingFace Token Setup

Pyannote models require a HuggingFace token with model access:

1. Create an account at [huggingface.co](https://huggingface.co)
2. Accept the model licenses:
   - [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)
   - [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0)
3. Generate an access token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
4. Set the environment variable:
   ```bash
   export HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxx
   ```

### Bundle Size Optimization

The default bundle is ~1.5-2 GB. To reduce size:

1. **Exclude unused model sizes**: Edit `python/transcription_bundle.spec` to exclude large model weights
2. **Use UPX compression**: Enabled by default in the spec file
3. **Strip debug symbols**: Configured in PyInstaller spec

### Troubleshooting Python Bundle

**Bundle build fails with "Module not found":**
```bash
# Ensure all dependencies are installed
pip install -r python/requirements.txt

# Rebuild with verbose output
npm run bundle:python -- --verbose
```

**Bundle too large:**
```bash
# Check bundle size
ls -lh resources/python-bundle/

# Consider excluding test files and docs in the spec
```

**Models fail to download:**
- Check HF_TOKEN is set correctly
- Verify model access permissions on HuggingFace
- Check network connectivity

**Transcription/diarization fails in bundled app:**
```bash
# Verify bundle works
npm run bundle:python:verify

# Check bundle executable directly
./resources/python-bundle/transcription_bundle check
```

## Build Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build and package for current platform |
| `npm run pack` | Build and create unpacked directory (for testing) |
| `npm run dist` | Build and create distributable for current platform |
| `npm run dist:mac` | Build for macOS (both x64 and arm64) |
| `npm run dist:mac:x64` | Build for macOS Intel only |
| `npm run dist:mac:arm64` | Build for macOS Apple Silicon only |
| `npm run dist:mac:universal` | Build universal macOS binary |
| `npm run dist:win` | Build for Windows |
| `npm run dist:win:x64` | Build for Windows 64-bit |
| `npm run dist:win:ia32` | Build for Windows 32-bit |
| `npm run dist:linux` | Build for Linux |
| `npm run dist:all` | Build for all platforms |

## Output

Built distributables are placed in the `release/{version}/` directory:

- **macOS**: `.dmg`, `.zip`
- **Windows**: `.exe` (NSIS installer), `.zip`, portable `.exe`
- **Linux**: `.AppImage`, `.deb`, `.rpm`, `.snap`

## Platform-Specific Requirements

### macOS

- Xcode Command Line Tools: `xcode-select --install`
- For notarization: Valid Apple Developer account

### Windows

- For building on macOS/Linux: Wine is required
- Visual Studio Build Tools (on Windows)

### Linux

- `rpm` package for building RPM: `sudo apt install rpm`
- `snapcraft` for building Snap: `sudo snap install snapcraft --classic`

## Code Signing

### macOS Code Signing

For distribution outside the App Store, you need:

1. An Apple Developer account ($99/year)
2. A Developer ID Application certificate

**Environment Variables:**

```bash
# Certificate (choose one method)
export CSC_LINK="path/to/certificate.p12"  # Path to certificate
# OR
export CSC_LINK="base64-encoded-certificate"  # Base64-encoded certificate

# Certificate password
export CSC_KEY_PASSWORD="your-certificate-password"
```

**To skip code signing (for testing):**

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
```

### macOS Notarization

Apple requires notarization for apps distributed outside the App Store (macOS 10.15+).

**Environment Variables:**

```bash
# Apple ID credentials
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

**Generating an App-Specific Password:**

1. Go to [appleid.apple.com](https://appleid.apple.com)
2. Sign in and navigate to Security > App-Specific Passwords
3. Click "Generate Password"
4. Enter a label (e.g., "Electron Builder")
5. Copy the generated password

**Finding Your Team ID:**

1. Log in to [developer.apple.com](https://developer.apple.com)
2. Go to Account > Membership
3. Your Team ID is listed there

### Windows Code Signing

For trusted distribution on Windows, you need a code signing certificate.

**Environment Variables:**

```bash
# Certificate
export CSC_LINK="path/to/certificate.pfx"
export CSC_KEY_PASSWORD="your-certificate-password"
```

**Certificate Providers:**

- DigiCert
- Sectigo (Comodo)
- GlobalSign
- SSL.com

**To skip code signing (for testing):**

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
```

## Virtual Audio Drivers

FlowRecap supports capturing system audio using virtual audio drivers. This is useful for recording audio from video conferencing apps.

### Bundling Virtual Audio Drivers

To include virtual audio driver installers in your distribution:

#### Windows: VB-Audio Virtual Cable

1. Download from https://vb-audio.com/Cable/
2. Extract `VBCABLE_Driver_Pack43.zip`
3. Place `VBCable_Driver_Pack.exe` in `resources/drivers/windows/`
4. The NSIS installer will offer to install this driver during app installation

```bash
# Directory structure
resources/
└── drivers/
    └── windows/
        └── VBCable_Driver_Pack.exe
```

#### macOS: BlackHole

1. Download from https://existential.audio/blackhole/
2. Get `BlackHole2ch.pkg` (2-channel version)
3. Place in `resources/drivers/macos/`
4. The app will prompt users to install if not detected

```bash
# Directory structure
resources/
└── drivers/
    └── macos/
        └── BlackHole2ch.pkg
```

#### Linux: PulseAudio Virtual Sink

Linux uses PulseAudio's built-in virtual sink capability. A setup script is included:

```bash
# Run the setup script
./resources/drivers/linux/setup-virtual-sink.sh

# Or manually create the virtual sink
pactl load-module module-null-sink \
    sink_name=flowrecap_sink \
    sink_properties=device.description="FlowRecap Virtual Sink"
```

### Driver License Compliance

- **VB-Audio Virtual Cable**: Donationware (free for personal use)
- **BlackHole**: MIT License (open source)
- **PulseAudio**: LGPL (part of Linux distributions)

## Icons

Application icons are stored in the `resources/icons/` directory with a unified structure that supports all platforms.

### Directory Structure

```
resources/icons/
├── icon.icns      # macOS application icon
├── icon.ico       # Windows application icon
├── icon.png       # Source PNG (512x512) for reference
├── 16x16.png      # Linux icon size
├── 32x32.png      # Linux icon size
├── 64x64.png      # Linux icon size
├── 128x128.png    # Linux icon size
├── 256x256.png    # Linux icon size
└── 512x512.png    # Linux icon size (also used for high-DPI)
```

### Platform-Specific Usage

| Platform | File | Usage |
|----------|------|-------|
| macOS | `icon.icns` | Dock, Finder, DMG installer, window decorations |
| Windows | `icon.ico` | Taskbar, File Explorer, NSIS installer, shortcuts |
| Linux | `*.png` sizes | Application menu, window decorations, taskbar, AppImage/deb/rpm/snap |

### Updating Application Icons

To replace the app icon with your own:

1. **Replace files in `resources/icons/`** with your new versions
2. **Maintain the same filenames and formats** - the build system expects these exact names
3. **Rebuild the application** with `npm run dist`

**Quick replacement using a single source PNG (1024x1024 recommended):**

```bash
# Navigate to the icons directory
cd resources/icons

# Replace the source icon
cp /path/to/your/new-icon.png icon.png

# Generate all required sizes (see commands below)
```

### Creating Icons from Source

**From a source PNG (1024x1024 recommended):**

**macOS (icns):**
```bash
# Using iconutil (macOS only)
mkdir icon.iconset
sips -z 16 16 icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32 icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32 icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64 icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset
mv icon.icns resources/icons/
rm -rf icon.iconset
```

**Windows (ico):**
```bash
# Using ImageMagick
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
mv icon.ico resources/icons/
```

**Linux (multiple PNGs):**
```bash
# Using sips (macOS) or ImageMagick
cd resources/icons
for size in 16 32 64 128 256 512; do
  sips -z $size $size icon.png --out ${size}x${size}.png
done
# Or with ImageMagick:
# for size in 16 32 64 128 256 512; do
#   convert icon.png -resize ${size}x${size} ${size}x${size}.png
# done
```

### Icon Display Locations

Icons will be displayed in the following locations after building:

**macOS:**
- Dock icon (when app is running)
- Finder (application icon)
- DMG installer background
- Mission Control and App Switcher

**Windows:**
- Taskbar icon (when app is running)
- Start menu shortcut
- File Explorer (application icon)
- NSIS installer splash and shortcuts
- Alt+Tab switcher

**Linux:**
- Application menu entry
- Taskbar/dock (when app is running)
- Window decorations (title bar)
- AppImage, deb, rpm, snap package icons

### High-DPI Display Support

The icon files support high-DPI (Retina, 4K) displays:
- macOS: The `.icns` file contains multiple resolutions with @2x variants
- Windows: The `.ico` file contains sizes up to 256x256 for scaling
- Linux: The 512x512.png is used for high-DPI displays

For best results on Retina/4K displays, use a 1024x1024 source image with sharp edges and clear details.

## Continuous Integration

### GitHub Actions Example

Create `.github/workflows/build.yml`:

```yaml
name: Build

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]

    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run dist
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: release-${{ matrix.os }}
          path: release/**/*
```

## Troubleshooting

### Common Issues

**1. "Cannot find module 'electron'"**
```bash
npm run postinstall
```

**2. macOS signing fails with "No identity found"**
```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
```

**3. Windows build fails on macOS/Linux**
- Install Wine: `brew install --cask wine-stable`

**4. Linux build fails with missing dependencies**
```bash
sudo apt install rpm snapcraft
```

**5. Notarization fails**
- Verify your Apple ID and Team ID
- Ensure your app-specific password is correct
- Check that your certificate is a "Developer ID Application" certificate

### Debug Mode

For verbose build output:
```bash
DEBUG=electron-builder npm run dist
```

## Auto-Updates

The build configuration includes a publish configuration for auto-updates. To enable:

1. Set up a release server or use GitHub Releases
2. Update `electron-builder.config.cjs` with your publish URL
3. Implement `electron-updater` in your main process

Example:
```javascript
import { autoUpdater } from 'electron-updater';

autoUpdater.checkForUpdatesAndNotify();
```

## Native Module Externalization Strategy

FlowRecap uses several native Node.js modules that require special handling during bundling. This section documents how these modules are configured for both development and production environments.

### Why Externalization?

Native Node.js modules contain compiled `.node` files (native addons) that:
- Cannot be bundled by Vite/Rollup
- Must be loaded at runtime by Node.js
- Require access to the actual binary files on disk

### Currently Externalized Modules

| Module | Purpose | Has Native Code |
|--------|---------|-----------------|
| `electron` | Electron runtime | Runtime |
| `better-sqlite3` | SQLite database | ✅ Yes (.node) |
| `archiver` | ZIP archive creation | ✅ Yes (zlib) |
| `node-record-lpcm16` | Audio recording | ✅ Yes |
| `wav` | WAV file handling | ✅ Yes |
| `electron-log` | Logging | No |
| `electron-updater` | Auto-updates | No |
| `dotenv` | Environment config | No |

### How Externalization Works

#### 1. Vite Configuration (`vite.config.ts`)

The Vite configuration uses a comprehensive externalization function that:
- Externalizes all Node.js built-in modules (fs, path, crypto, etc.)
- Externalizes all `node:*` prefixed modules
- Externalizes electron and electron/* paths
- Externalizes all modules in the `nativeModules` array
- Externalizes all node_modules (loaded at runtime)

```typescript
// vite.config.ts - Key configuration
const nativeModules = [
  'electron',
  'better-sqlite3',
  'archiver',
  'node-record-lpcm16',
  // ... more modules
]

function shouldExternalize(id: string): boolean {
  // Returns true for modules that should NOT be bundled
}
```

#### 2. Electron Builder Configuration (`electron-builder.config.cjs`)

The electron-builder configuration ensures native modules are:
- Included in the final package via the `files` array
- Unpacked from ASAR via the `asarUnpack` array

```javascript
// electron-builder.config.cjs - Key configuration
asarUnpack: [
  "**/node_modules/better-sqlite3/**/*",
  "**/node_modules/bindings/**/*",
  "**/*.node",
  // ... more patterns
]
```

#### 3. Database Service (`electron/services/database.ts`)

The database service implements conditional require() logic to handle:
- Development mode: Loads from node_modules directly
- Production mode (ASAR): Loads from app.asar.unpacked/
- Test mode: Uses fallback paths

```typescript
function loadBetterSqlite3() {
  try {
    return require('better-sqlite3')
  } catch (error) {
    // Fallback to unpacked path in production
    const unpackedPath = appPath.replace('.asar', '.asar.unpacked')
    return require(path.join(unpackedPath, 'node_modules', 'better-sqlite3'))
  }
}
```

### Adding New Native Dependencies

When adding a new native module to the project, follow these steps:

1. **Install the module:**
   ```bash
   npm install new-native-module
   ```

2. **Update `vite.config.ts`:**
   Add the module name to the `nativeModules` array:
   ```typescript
   const nativeModules = [
     // ... existing modules
     'new-native-module'
   ]
   ```

3. **Update `electron-builder.config.cjs`:**
   Add an asarUnpack pattern:
   ```javascript
   asarUnpack: [
     // ... existing patterns
     "**/node_modules/new-native-module/**/*"
   ]
   ```

4. **Implement conditional loading (if needed):**
   For complex native modules, implement a loading function similar to `loadBetterSqlite3()`.

5. **Test in both modes:**
   ```bash
   # Test in development
   npm run dev

   # Test in production
   npm run dist
   # Install and run the packaged app
   ```

### Troubleshooting Native Modules

**1. "Cannot find module 'better-sqlite3'" in production**
- Ensure the module is listed in `asarUnpack`
- Check that `**/*.node` is in asarUnpack
- Verify the module's dependencies are also unpacked (e.g., `bindings`)

**2. "Module did not self-register" error**
- The native module may have been built for a different Node.js version
- Run `npm run postinstall` to rebuild native modules for Electron's Node.js version

**3. Native module loads in dev but not production**
- Check if the module path is inside ASAR
- Implement conditional loading logic like in `database.ts`
- Use `app.getAppPath()` to detect ASAR environment

**4. ASAR-related path issues**
```javascript
// Check if running from ASAR
const isAsar = app.getAppPath().includes('.asar')
if (isAsar) {
  const unpackedPath = app.getAppPath().replace('.asar', '.asar.unpacked')
  // Load from unpackedPath
}
```

### Production Architecture

```
FlowRecap.app/
├── Contents/
│   └── Resources/
│       ├── app.asar              # Bundled application code
│       ├── app.asar.unpacked/    # Unpacked native modules
│       │   └── node_modules/
│       │       ├── better-sqlite3/
│       │       │   └── build/Release/
│       │       │       └── better_sqlite3.node
│       │       └── ...
│       └── resources/            # Static resources
└── ...
```

### Testing Native Module Loading

To verify native modules work correctly:

```bash
# Development mode test
npm run dev
# In the app, perform an action that uses the native module
# (e.g., create a meeting to test better-sqlite3)

# Production mode test
npm run dist
# Install the built app
# Perform the same action to verify production loading
```
