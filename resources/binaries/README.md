# Audio Processing Binaries

This directory contains platform-specific audio processing binaries bundled with the Meeting Notes application.

## Directory Structure

```
binaries/
├── macos/
│   ├── arm64/          # macOS Apple Silicon (M1/M2/M3)
│   │   ├── sox
│   │   ├── ffmpeg
│   │   └── ffprobe
│   └── x64/            # macOS Intel
│       ├── sox
│       ├── ffmpeg
│       └── ffprobe
├── windows/
│   └── x64/            # Windows 64-bit
│       ├── sox.exe
│       ├── ffmpeg.exe
│       └── ffprobe.exe
├── linux/
│   └── x64/            # Linux 64-bit
│       ├── sox
│       ├── ffmpeg
│       └── ffprobe
├── checksums.json      # SHA256 checksums for verification
└── README.md           # This file
```

## Required Binaries

### Sox (Sound eXchange)
- **Purpose**: Audio recording from specific devices, sample rate detection
- **Version**: 14.4.2 or later recommended
- **License**: GPL-2.0 / LGPL-2.1
- **Website**: https://sox.sourceforge.net/

### FFmpeg / FFprobe
- **Purpose**: Audio format conversion, mixing, extraction from video
- **Version**: 5.0 or later recommended
- **License**: LGPL-2.1 / GPL-2.0 (depending on build configuration)
- **Website**: https://ffmpeg.org/

## Obtaining Binaries

### macOS (Homebrew)
```bash
# Install via Homebrew
brew install sox ffmpeg

# Find binary locations
which sox ffmpeg ffprobe

# Copy to appropriate directory
cp $(which sox) resources/binaries/macos/arm64/  # For M1/M2/M3
cp $(which sox) resources/binaries/macos/x64/    # For Intel
```

### macOS (Static builds)
For distribution, use statically-linked builds:
- **Sox**: Build from source with static linking
- **FFmpeg**: Download static builds from https://evermeet.cx/ffmpeg/ (macOS)

### Windows
- **Sox**: Download from https://sox.sourceforge.net/
- **FFmpeg**: Download from https://www.gyan.dev/ffmpeg/builds/ (static builds recommended)

### Linux
- **Sox**: `apt install sox` or build statically
- **FFmpeg**: Download static builds from https://johnvansickle.com/ffmpeg/

## Generating Checksums

After adding binaries, generate checksums for verification:

```bash
# Generate checksums
npm run generate-binary-checksums

# Or manually:
shasum -a 256 resources/binaries/**/* > checksums.txt
```

## First-Run Download (Optional)

For large binaries like FFmpeg (~100MB), consider implementing first-run download:

1. Bundle only sox (~1MB) in the initial package
2. On first run, download ffmpeg if needed
3. Store downloaded binary in user data directory
4. Verify checksum before use

## License Compliance

When distributing binaries:

1. **GPL/LGPL Compliance**:
   - Include license text in the application
   - Provide source code access if using GPL components
   - Document build configuration and any modifications

2. **Attribution**:
   - Credit Sox and FFmpeg in your application's About dialog
   - Include license files in distribution

3. **Static vs Dynamic Linking**:
   - Static linking with LGPL libraries requires providing object files
   - Prefer dynamic linking or carefully review license requirements

## Troubleshooting

### Binary not found
1. Check the binary exists in the correct platform/arch directory
2. Verify file permissions (chmod +x on macOS/Linux)
3. Check the application logs for detailed error messages

### Checksum mismatch
1. Re-download the binary from the official source
2. Verify the download wasn't corrupted
3. Update checksums.json if using a newer version

### Permission denied (macOS)
1. Remove quarantine attribute: `xattr -dr com.apple.quarantine resources/binaries/`
2. Sign the binary with ad-hoc signature: `codesign -s - resources/binaries/macos/arm64/sox`

### Windows SmartScreen warning
1. Sign the binaries with a code signing certificate
2. Or build from source on the target machine

## Development Notes

The `binaryManager.ts` service handles:
- Automatic platform/arch detection
- Bundled vs system binary resolution
- Executable permissions (chmod +x)
- SHA256 checksum verification
- Fallback to system PATH if bundled not found

To test binary resolution:
```typescript
import { binaryManager } from './electron/services/binaryManager'

await binaryManager.initialize()
const diagnostics = await binaryManager.getDiagnostics()
console.log(diagnostics)
```
