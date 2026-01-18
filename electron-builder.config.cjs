/**
 * Electron Builder Configuration
 *
 * Cross-platform packaging configuration for Windows (NSIS), macOS (DMG), and Linux (AppImage/deb).
 * Includes virtual audio driver installer support and code signing configuration.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * CODE SIGNING SETUP
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * For macOS (Required for distribution):
 *   Set environment variables:
 *   - CSC_LINK: Path to .p12 certificate file or base64-encoded certificate
 *   - CSC_KEY_PASSWORD: Certificate password
 *   - APPLE_ID: Apple ID for notarization
 *   - APPLE_APP_SPECIFIC_PASSWORD: App-specific password for notarization
 *   - APPLE_TEAM_ID: Apple Developer Team ID
 *
 * For Windows (Recommended for trusted distribution):
 *   Set environment variables:
 *   - CSC_LINK: Path to .pfx certificate file or base64-encoded certificate
 *   - CSC_KEY_PASSWORD: Certificate password
 *   - WIN_CSC_LINK: (Optional) Separate Windows certificate if different from macOS
 *   - WIN_CSC_KEY_PASSWORD: (Optional) Windows certificate password
 *
 * For unsigned builds (development/testing):
 *   Set CSC_IDENTITY_AUTO_DISCOVERY=false to skip code signing
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * VIRTUAL AUDIO DRIVER BUNDLING
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Virtual audio drivers are required for system audio capture.
 * Place driver installers in resources/drivers/:
 *
 *   Windows:
 *     - resources/drivers/windows/VBCable_Driver_Pack.exe
 *     - Download from: https://vb-audio.com/Cable/
 *
 *   macOS:
 *     - resources/drivers/macos/BlackHole2ch.pkg
 *     - Download from: https://existential.audio/blackhole/
 *
 *   Linux:
 *     - PulseAudio virtual sink is built-in (no driver needed)
 *     - Optional: resources/drivers/linux/setup-virtual-sink.sh
 *
 * The NSIS installer will optionally install VB-Audio Virtual Cable on Windows.
 * macOS users are prompted to install BlackHole on first launch if not detected.
 */

const path = require('path');
const fs = require('fs');

// Helper to check if driver files exist
const driversPath = path.join(__dirname, 'resources', 'drivers');
const hasWindowsDriver = fs.existsSync(path.join(driversPath, 'windows', 'VBCable_Driver_Pack.exe'));
const hasMacOSDriver = fs.existsSync(path.join(driversPath, 'macos', 'BlackHole2ch.pkg'));

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIO PROCESSING BINARY DETECTION
// ═══════════════════════════════════════════════════════════════════════════════
//
// Platform-specific audio processing binaries (sox, ffmpeg) can be bundled for
// standalone distribution. This eliminates the need for users to install these
// tools manually.
//
// To download/prepare binaries:
//   npm run download-binaries
//
// Binary structure:
//   resources/binaries/
//     ├── macos/arm64/     (macOS Apple Silicon)
//     │   ├── sox
//     │   ├── ffmpeg
//     │   └── ffprobe
//     ├── macos/x64/       (macOS Intel)
//     ├── windows/x64/     (Windows 64-bit)
//     │   ├── sox.exe
//     │   ├── ffmpeg.exe
//     │   └── ffprobe.exe
//     └── linux/x64/       (Linux 64-bit)
//
const binariesPath = path.join(__dirname, 'resources', 'binaries');

// Check for bundled binaries based on current build platform
function hasBinariesForPlatform(platform, arch) {
  const platformDir = platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : platform;
  const binDir = path.join(binariesPath, platformDir, arch);
  const ext = platform === 'win32' ? '.exe' : '';
  const soxPath = path.join(binDir, `sox${ext}`);
  const ffmpegPath = path.join(binDir, `ffmpeg${ext}`);
  return fs.existsSync(soxPath) || fs.existsSync(ffmpegPath);
}

// Detect available binaries for each platform
const hasMacOSARM64Binaries = hasBinariesForPlatform('darwin', 'arm64');
const hasMacOSX64Binaries = hasBinariesForPlatform('darwin', 'x64');
const hasWindowsBinaries = hasBinariesForPlatform('win32', 'x64');
const hasLinuxBinaries = hasBinariesForPlatform('linux', 'x64');

// Log binary bundle status
const binariesFound = [];
if (hasMacOSARM64Binaries) binariesFound.push('macOS/arm64');
if (hasMacOSX64Binaries) binariesFound.push('macOS/x64');
if (hasWindowsBinaries) binariesFound.push('Windows/x64');
if (hasLinuxBinaries) binariesFound.push('Linux/x64');

if (binariesFound.length > 0) {
  console.log(`[electron-builder] Audio binaries detected for: ${binariesFound.join(', ')}`);
} else {
  console.log('[electron-builder] No bundled audio binaries found - app will use system PATH');
  console.log('[electron-builder] Run "npm run download-binaries" to bundle audio processing tools');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PYTHON BUNDLE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════
//
// The Python transcription pipeline can be bundled for standalone distribution.
// This eliminates the need for users to install Python and dependencies manually.
//
// To create the bundle:
//   npm run bundle:python
//
// The bundle will be placed in resources/python-bundle/ and automatically
// included in the app distribution.
//
// Bundle structure:
//   resources/python-bundle/
//     ├── transcription_bundle (or .exe on Windows)
//     ├── _internal/           (PyInstaller runtime)
//     └── *.py                 (Python scripts)
//
const pythonBundlePath = path.join(__dirname, 'resources', 'python-bundle');
const hasPythonBundle = fs.existsSync(pythonBundlePath) &&
  fs.existsSync(path.join(pythonBundlePath, process.platform === 'win32' ? 'transcription_bundle.exe' : 'transcription_bundle'));

// Also check for development Python environment (venv)
const pythonDevPath = path.join(__dirname, 'python');
const hasPythonDev = fs.existsSync(path.join(pythonDevPath, 'venv-3.12')) ||
  fs.existsSync(path.join(pythonDevPath, 'venv'));

// Log Python bundle status
if (hasPythonBundle) {
  console.log('[electron-builder] Python bundle detected - will include in distribution');
} else if (hasPythonDev) {
  console.log('[electron-builder] Python dev environment detected - bundling Python scripts only');
  console.log('[electron-builder] Run "npm run bundle:python" to create standalone bundle');
} else {
  console.log('[electron-builder] No Python environment found - transcription features will require manual setup');
}

const config = {
  appId: "com.flowrecap.app",
  productName: "FlowRecap",
  copyright: `Copyright © ${new Date().getFullYear()}`,

  // Build ID for updates
  buildVersion: process.env.BUILD_NUMBER || undefined,

  // ═══════════════════════════════════════════════════════════════════════════════
  // APPLICATION ICONS
  // ═══════════════════════════════════════════════════════════════════════════════
  //
  // Icons are stored in resources/icons/ directory with standard naming:
  //   - icon.icns  (macOS)
  //   - icon.ico   (Windows)
  //   - icon.png   (Linux, source - 512x512)
  //   - 16x16.png, 32x32.png, 64x64.png, 128x128.png, 256x256.png, 512x512.png (Linux sizes)
  //
  // To update the app icon:
  //   1. Replace files in resources/icons/ with new versions
  //   2. Maintain the same filenames and formats
  //   3. Rebuild the application
  //
  // Creating icons from source PNG (1024x1024 recommended):
  //   See BUILD.md for platform-specific icon creation instructions
  //
  icon: "resources/icons/icon",

  // Directories configuration
  directories: {
    output: "release/${version}",
    buildResources: "resources"
  },

  // Files to include in the package
  files: [
    "dist/**/*",
    "dist-electron/**/*",
    // Ensure production dependencies are included
    "node_modules/**/*",
    // Exclusions to reduce bundle size
    "!**/*.ts",
    "!**/*.map",
    "!**/node_modules/**/*.md",
    "!**/node_modules/**/*.d.ts",
    "!**/node_modules/**/*.ts",
    "!**/node_modules/**/*.map",
    "!**/node_modules/**/test/**",
    "!**/node_modules/**/tests/**",
    "!**/node_modules/**/example/**",
    "!**/node_modules/**/examples/**",
    "!**/node_modules/**/.bin/**",
    "!**/node_modules/**/.github/**",
    "!**/node_modules/**/CHANGELOG.md",
    "!**/node_modules/**/README.md",
    "!**/node_modules/**/LICENSE*",
    "!**/node_modules/**/*.gyp",
    "!**/node_modules/**/*.gypi",
    "!**/node_modules/**/binding.gyp",
    "!**/node_modules/**/Makefile",
    "!**/node_modules/**/CMakeLists.txt",
    // Exclude source files for native modules (keep compiled .node files)
    "!**/node_modules/**/src/**/*.cc",
    "!**/node_modules/**/src/**/*.cpp",
    "!**/node_modules/**/src/**/*.c",
    "!**/node_modules/**/src/**/*.h",
    "!**/node_modules/**/src/**/*.hpp"
  ],

  // Additional resources to copy (not processed)
  extraResources: [
    {
      from: "resources/",
      to: "resources/",
      filter: ["**/*", "!.gitkeep", "!drivers/**", "!python-bundle/**", "!binaries/**", "!icons/**"]
    },
    // Include icons directory separately for better organization
    {
      from: "resources/icons/",
      to: "resources/icons/",
      filter: ["**/*"]
    },
    // Include virtual audio drivers if they exist
    ...(hasWindowsDriver ? [{
      from: "resources/drivers/windows/",
      to: "drivers/windows/",
      filter: ["**/*"]
    }] : []),
    ...(hasMacOSDriver ? [{
      from: "resources/drivers/macos/",
      to: "drivers/macos/",
      filter: ["**/*"]
    }] : []),
    // ========================================================================
    // AUDIO PROCESSING BINARIES
    // ========================================================================
    // Include platform-specific audio binaries (sox, ffmpeg) if available.
    // Uses electron-builder's platform detection to include correct binaries.
    // macOS ARM64 (Apple Silicon M1/M2/M3)
    ...(hasMacOSARM64Binaries ? [{
      from: "resources/binaries/macos/arm64/",
      to: "resources/binaries/macos/arm64/",
      filter: ["**/*"]
    }] : []),
    // macOS x64 (Intel)
    ...(hasMacOSX64Binaries ? [{
      from: "resources/binaries/macos/x64/",
      to: "resources/binaries/macos/x64/",
      filter: ["**/*"]
    }] : []),
    // Windows x64
    ...(hasWindowsBinaries ? [{
      from: "resources/binaries/windows/x64/",
      to: "resources/binaries/windows/x64/",
      filter: ["**/*"]
    }] : []),
    // Linux x64
    ...(hasLinuxBinaries ? [{
      from: "resources/binaries/linux/x64/",
      to: "resources/binaries/linux/x64/",
      filter: ["**/*"]
    }] : []),
    // Always include binaries documentation and checksums
    {
      from: "resources/binaries/",
      to: "resources/binaries/",
      filter: ["README.md", "checksums.json"]
    },
    // ========================================================================
    // PYTHON ENVIRONMENT - EXTERNAL VENV APPROACH
    // ========================================================================
    // We use external virtual environments (venv) instead of PyInstaller bundles
    // because ML packages (PyTorch, WhisperX, Pyannote) are too complex to bundle.
    //
    // On first launch, setup scripts create two separate venvs:
    //   - venv-whisperx: For transcription (WhisperX + PyTorch 2.8)
    //   - venv-pyannote: For diarization (Pyannote + PyTorch 2.5.1)
    //
    // This approach is:
    //   ✓ More reliable than PyInstaller for ML packages
    //   ✓ Smaller app download size
    //   ✓ Easier to update Python dependencies
    //   ✓ Industry standard for ML desktop apps
    //
    // Include Python scripts and setup tools
    {
      from: "python/",
      to: "python/",
      filter: [
        "*.py",                       // All Python scripts
        "requirements*.txt",          // All requirements files (main + whisperx + pyannote)
        "setup_environments.sh",      // macOS/Linux setup script
        "setup_environments.bat",     // Windows setup script
        "!__pycache__/**",           // Exclude cache
        "!*.pyc",                     // Exclude bytecode
        "!venv/**",                  // Exclude venv (created at runtime)
        "!venv-*/**",                // Exclude all venv dirs
        "!dist/**",                  // Exclude PyInstaller dist
        "!build/**",                 // Exclude PyInstaller build
        "!*.spec",                   // Exclude spec files
        "!hooks/**"                  // Exclude PyInstaller hooks
      ]
    },
    // Include .env file for bundled HF_TOKEN and other environment variables
    {
      from: ".env",
      to: ".env",
      filter: ["**/*"]
    }
  ],

  // Compression settings
  compression: "maximum",

  // ═══════════════════════════════════════════════════════════════════════════════
  // ASAR CONFIGURATION FOR NATIVE MODULES
  // ═══════════════════════════════════════════════════════════════════════════════
  //
  // Asar is enabled for better performance and protection, but native modules
  // must be unpacked since they contain .node binaries that need to be loaded
  // by Node.js at runtime.
  //
  // The asarUnpack patterns extract these modules from the asar archive to the
  // app.asar.unpacked directory, allowing proper loading of native bindings.
  //
  // ADDING NEW NATIVE DEPENDENCIES:
  // When adding a new native module to the project:
  // 1. Add it to the `nativeModules` array in vite.config.ts
  // 2. Add an asarUnpack pattern below for its node_modules directory
  // 3. If it has .node files, they're already covered by the "**/*.node" pattern
  // 4. Test in both dev (npm run dev) and production (installed app) modes
  //
  asar: true,
  asarUnpack: [
    // ========================================================================
    // NATIVE DATABASE MODULE
    // ========================================================================
    // better-sqlite3 contains compiled SQLite bindings (.node files)
    // Must be unpacked to allow Node.js to load the native addon
    "**/node_modules/better-sqlite3/**/*",

    // bindings is a helper module for loading native .node files
    // Required by better-sqlite3 and other native modules
    "**/node_modules/bindings/**/*",

    // file-uri-to-path is a dependency of bindings
    "**/node_modules/file-uri-to-path/**/*",

    // ========================================================================
    // AUDIO RECORDING MODULES
    // ========================================================================
    // node-record-lpcm16 uses native audio capture bindings
    "**/node_modules/node-record-lpcm16/**/*",

    // wav module for WAV file handling (may have native dependencies)
    "**/node_modules/wav/**/*",

    // ========================================================================
    // ELECTRON UTILITY MODULES
    // ========================================================================
    // electron-updater may need native crypto bindings
    "**/node_modules/electron-updater/**/*",

    // ========================================================================
    // ARCHIVE CREATION
    // ========================================================================
    // archiver uses native zlib bindings for compression
    "**/node_modules/archiver/**/*",
    "**/node_modules/zip-stream/**/*",
    "**/node_modules/compress-commons/**/*",
    "**/node_modules/crc-32/**/*",

    // ========================================================================
    // NATIVE BINDING FILES
    // ========================================================================
    // Any .node files (native bindings) across all modules
    // This is a catch-all for native addons that may be missed above
    "**/*.node",

    // ========================================================================
    // SOX AND AUDIO PROCESSING BINARIES
    // ========================================================================
    // Sox binaries for audio processing (if used via node_modules)
    "**/node_modules/**/sox*/**/*",
    "**/node_modules/**/rec*/**/*",

    // ========================================================================
    // BUNDLED AUDIO BINARIES
    // ========================================================================
    // Platform-specific sox, ffmpeg binaries bundled with the app
    // These must be unpacked for execution
    "**/resources/binaries/**/*",

    // ========================================================================
    // ML MODELS
    // ========================================================================
    // ML models that may be bundled with the app
    "**/models/**/*",
    "**/*.onnx",
    "**/*.bin",

    // ========================================================================
    // PYTHON BUNDLE
    // ========================================================================
    // Python scripts and bundled executables for ML pipeline
    "**/python/**/*"
  ],

  // Publish configuration (for auto-updates)
  publish: [
    {
      provider: "generic",
      url: process.env.UPDATE_SERVER_URL || "https://your-update-server.com/releases/",
      channel: "latest"
    },
    // Uncomment to enable GitHub Releases as update source
    // {
    //   provider: "github",
    //   owner: "your-github-username",
    //   repo: "flowrecap",
    //   releaseType: "release"
    // }
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // macOS Configuration (DMG + ZIP)
  // ═══════════════════════════════════════════════════════════════════════════
  mac: {
    // macOS app icon (uses ICNS format)
    // Icon is used for: Dock, Finder, application window, DMG installer
    icon: "resources/icons/icon.icns",

    category: "public.app-category.productivity",
    // App Store category IDs
    // public.app-category.productivity - Productivity
    // public.app-category.business - Business
    // public.app-category.utilities - Utilities

    // Code signing for distribution
    hardenedRuntime: true,
    gatekeeperAssess: false,

    // Entitlements for hardened runtime
    entitlements: "resources/entitlements.mac.plist",
    entitlementsInherit: "resources/entitlements.mac.plist",

    // Extended attributes (required for notarization)
    extendInfo: {
      NSMicrophoneUsageDescription: "FlowRecap needs access to your microphone to record audio.",
      NSCameraUsageDescription: "FlowRecap needs camera access for screen capture functionality."
    },

    // Build targets
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"]
      },
      {
        target: "zip",
        arch: ["x64", "arm64"]
      }
    ],

    // Minimum macOS version
    minimumSystemVersion: "10.15"
  },

  // macOS DMG Configuration
  dmg: {
    // DMG window appearance
    contents: [
      {
        x: 130,
        y: 220
      },
      {
        x: 410,
        y: 220,
        type: "link",
        path: "/Applications"
      }
    ],
    window: {
      width: 540,
      height: 380
    },
    // Optional: Custom background image
    // background: "resources/dmg-background.png",
    title: "FlowRecap",
    // Icon positions
    iconSize: 80,
    iconTextSize: 12
  },

  // macOS Notarization (automatically runs after signing if credentials are set)
  afterSign: process.env.APPLE_ID ? "scripts/notarize.cjs" : undefined,

  // ═══════════════════════════════════════════════════════════════════════════
  // Windows Configuration (NSIS + ZIP + Portable)
  // ═══════════════════════════════════════════════════════════════════════════
  win: {
    // Windows app icon (uses ICO format)
    // Icon is used for: Taskbar, File Explorer, application window, shortcuts
    icon: "resources/icons/icon.ico",

    // Build targets
    target: [
      {
        target: "nsis",
        arch: ["x64", "ia32"]
      },
      {
        target: "zip",
        arch: ["x64"]
      },
      {
        target: "portable",
        arch: ["x64"]
      }
    ],

    // Code signing configuration
    // Requires CSC_LINK and CSC_KEY_PASSWORD environment variables
    signingHashAlgorithms: ["sha256"],
    // Timestamp server for long-term validity
    // Options: http://timestamp.digicert.com, http://timestamp.comodoca.com
    // timeStampServer: "http://timestamp.digicert.com",

    // Request admin elevation only when needed
    requestedExecutionLevel: "asInvoker",

    // Sign all executable files
    signAndEditExecutable: true
  },

  // Windows NSIS Installer Configuration
  nsis: {
    // Installer type
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false, // Install per-user by default

    // Shortcuts
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "FlowRecap",

    // Menu and uninstaller
    menuCategory: true,
    deleteAppDataOnUninstall: false,

    // Custom NSIS script for virtual audio driver installation
    include: fs.existsSync(path.join(__dirname, 'resources', 'installer', 'nsis-custom.nsh'))
      ? "resources/installer/nsis-custom.nsh"
      : undefined,

    // Allow NSIS warnings without failing the build
    // This is needed because the custom NSIS script has optional features
    // (like VirtualAudioPage) that may not be referenced in all build scenarios
    warningsAsErrors: false,

    // Installer language
    language: "1033", // English

    // Multi-language support
    // installerLanguages: ["en_US", "de_DE", "fr_FR", "es_ES", "ja_JP", "zh_CN"],

    // License agreement
    // license: "resources/LICENSE.txt",

    // Installer sidebar image (164x314 pixels)
    // installerSidebar: "resources/installer-sidebar.bmp",

    // Uninstaller sidebar image
    // uninstallerSidebar: "resources/installer-sidebar.bmp"
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Linux Configuration (AppImage + deb + rpm + snap)
  // ═══════════════════════════════════════════════════════════════════════════
  linux: {
    // Linux app icon (uses PNG format, multiple sizes)
    // Icons at various sizes stored in resources/icons/:
    //   16x16.png, 32x32.png, 64x64.png, 128x128.png, 256x256.png, 512x512.png
    // Used for: Application menu, window decorations, taskbar, file manager
    icon: "resources/icons",

    // Desktop entry category
    // Options: AudioVideo, Development, Education, Game, Graphics, Network,
    // Office, Science, Settings, System, Utility
    category: "Office",

    // Desktop file configuration
    desktop: {
      Name: "FlowRecap",
      Comment: "Record and transcribe meeting notes with AI",
      GenericName: "FlowRecap Application",
      Keywords: "flowrecap;meeting;notes;transcription;audio;recording;productivity;",
      StartupWMClass: "flowrecap",
      MimeType: "x-scheme-handler/flowrecap;",
      Categories: "Office;AudioVideo;Utility;"
    },

    // Build targets
    target: [
      {
        target: "AppImage",
        arch: ["x64"]
      },
      {
        target: "deb",
        arch: ["x64"]
      },
      {
        target: "rpm",
        arch: ["x64"]
      },
      {
        target: "snap",
        arch: ["x64"]
      }
    ],

    // File associations
    // fileAssociations: [
    //   {
    //     ext: "mtgnotes",
    //     name: "Meeting Notes File",
    //     description: "Meeting Notes document",
    //     mimeType: "application/x-meeting-notes"
    //   }
    // ],

    // Maintainer info for packages
    maintainer: process.env.MAINTAINER_EMAIL || "developer@flowrecap.app",
    vendor: "FlowRecap"
  },

  // AppImage configuration
  appImage: {
    // License file to display during installation
    // license: "resources/LICENSE.txt",

    // Desktop integration
    desktop: {
      Name: "FlowRecap",
      Comment: "Record and transcribe meeting notes",
      Categories: "Office;AudioVideo;"
    }
  },

  // Snap configuration
  snap: {
    grade: "stable",
    confinement: "classic", // Required for audio access

    // Snap-specific plugs for audio
    plugs: [
      "audio-playback",
      "audio-record",
      "pulseaudio",
      "home",
      "network",
      "desktop",
      "desktop-legacy",
      "x11",
      "wayland"
    ],

    // Hooks
    // afterInstall: "resources/snap/post-install.sh"
  },

  // Deb configuration
  deb: {
    // Dependencies for Debian/Ubuntu
    depends: [
      "libgtk-3-0",
      "libnotify4",
      "libnss3",
      "libxss1",
      "libxtst6",
      "xdg-utils",
      "libatspi2.0-0",
      "libuuid1",
      "pulseaudio",
      "libpulse0"  // PulseAudio for virtual audio
    ],
    recommends: [
      "ffmpeg",    // Audio processing
      "sox"        // Sound processing utilities
    ],
    // Package priority
    priority: "optional"
  },

  // RPM configuration
  rpm: {
    // Dependencies for Fedora/RHEL/CentOS
    depends: [
      "gtk3",
      "libnotify",
      "nss",
      "libXScrnSaver",
      "libXtst",
      "xdg-utils",
      "at-spi2-core",
      "libuuid",
      "pulseaudio",
      "pulseaudio-libs"
    ]
  },

  // Generate artifacts for each platform with consistent naming
  artifactName: "${productName}-${version}-${platform}-${arch}.${ext}"
};

module.exports = config;
