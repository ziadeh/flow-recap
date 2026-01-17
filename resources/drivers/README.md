# Virtual Audio Driver Installers

This directory contains virtual audio driver installers for system audio capture functionality.

## Required Drivers by Platform

### Windows: VB-Audio Virtual Cable

**Download:** https://vb-audio.com/Cable/

1. Download `VBCABLE_Driver_Pack43.zip` (or latest version)
2. Extract and place `VBCable_Driver_Pack.exe` in `windows/` folder
3. The installer will optionally offer to install this driver

**File:** `windows/VBCable_Driver_Pack.exe`

### macOS: BlackHole

**Download:** https://existential.audio/blackhole/

1. Download `BlackHole2ch.pkg` (2-channel version recommended)
2. Place in `macos/` folder
3. Users can install manually or app will prompt on first launch

**File:** `macos/BlackHole2ch.pkg`

### Linux: PulseAudio Virtual Sink

Linux uses PulseAudio's built-in virtual sink capability. No driver installation needed.

A setup script is provided for users who need help configuring the virtual sink:

**File:** `linux/setup-virtual-sink.sh`

## Directory Structure

```
drivers/
├── README.md           (this file)
├── windows/
│   └── VBCable_Driver_Pack.exe   (download from vb-audio.com)
├── macos/
│   └── BlackHole2ch.pkg          (download from existential.audio)
└── linux/
    └── setup-virtual-sink.sh     (included)
```

## Important Notes

1. **License Compliance:** Ensure you comply with the license terms of each driver:
   - VB-Audio Virtual Cable: Donationware (free for personal use)
   - BlackHole: MIT License (open source)
   - PulseAudio: LGPL (open source)

2. **Code Signing:** On Windows, the VB-Audio driver installer is signed by VB-Audio.
   The Meeting Notes installer should not re-sign this driver.

3. **macOS Notarization:** BlackHole is already notarized by Existential Audio.
   Including it as an optional resource won't affect your app's notarization.

4. **File Size:** Driver installers add approximately:
   - Windows: ~1-2 MB
   - macOS: ~1 MB
   - Linux: ~1 KB (script only)
