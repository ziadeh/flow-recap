---
title: Windows Troubleshooting
description: Common Windows-specific issues and solutions for FlowRecap
tags:
  - troubleshooting
  - windows
  - issues
  - solutions
  - errors
lastUpdated: true
prev:
  text: 'Windows Compatibility'
  link: '/development/WINDOWS_COMPATIBILITY_AUDIT'
next:
  text: 'Environment Warning Fix'
  link: '/troubleshooting/BUGFIX_ENVIRONMENT_WARNING'
---

# Windows Troubleshooting Guide

This guide covers common Windows-specific issues and solutions for FlowRecap.

## Table of Contents

1. [Installation Issues](#installation-issues)
2. [Python Environment Issues](#python-environment-issues)
3. [Audio Issues](#audio-issues)
4. [Path and File Issues](#path-and-file-issues)
5. [Performance Issues](#performance-issues)
6. [CLI Integration Issues](#cli-integration-issues)
7. [Diagnostic Tools](#diagnostic-tools)

---

## Installation Issues

### SmartScreen Warning

**Symptom:** Windows SmartScreen shows "Windows protected your PC" warning.

**Cause:** The installer is not code-signed (development builds) or certificate is not widely recognized.

**Solutions:**
1. Click "More info" then "Run anyway"
2. Right-click the installer, select Properties, check "Unblock", then click Apply
3. For enterprise deployments, add exception in Windows Defender settings

### Missing DLL Errors

**Symptom:** Error messages about missing `VCRUNTIME140.dll`, `MSVCP140.dll`, or similar.

**Cause:** Visual C++ Redistributable is not installed.

**Solution:**
```powershell
# Install via winget
winget install Microsoft.VCRedist.2015+.x64

# Or download manually from:
# https://aka.ms/vs/17/release/vc_redist.x64.exe
```

### Installation Path Issues

**Symptom:** Installation fails when choosing a custom directory.

**Cause:** Path contains special characters or is too long.

**Solutions:**
1. Use the default installation path (`%LOCALAPPDATA%\Programs\FlowRecap`)
2. Avoid paths with special characters: `< > : " | ? *`
3. Keep path length under 200 characters

### Silent Installation

For automated deployment:

```cmd
FlowRecap-Setup.exe /S /D=C:\Program Files\FlowRecap
```

Options:
- `/S` - Silent installation
- `/D=<path>` - Custom installation directory (must be last parameter)

---

## Python Environment Issues

### Python Not Detected

**Symptom:** App shows "Python not found" error.

**Diagnostic Steps:**
```cmd
# Check py launcher
py --list

# Check python in PATH
where python

# Check specific version
py -3.12 --version
```

**Solutions:**

1. **Install Python 3.12:**
   ```powershell
   winget install Python.Python.3.12
   ```

2. **Add to PATH manually:**
   ```cmd
   setx PATH "%PATH%;%LOCALAPPDATA%\Programs\Python\Python312"
   setx PATH "%PATH%;%LOCALAPPDATA%\Programs\Python\Python312\Scripts"
   ```

3. **Reinstall with PATH option:**
   - Download from python.org
   - Check "Add Python to PATH"
   - Check "Install py launcher"

### Virtual Environment Creation Fails

**Symptom:** Error when creating venv: "Permission denied" or "Access denied".

**Solutions:**

1. **Check disk space:**
   ```powershell
   Get-WmiObject Win32_LogicalDisk | Select-Object DeviceID, @{N='FreeGB';E={[math]::Round($_.FreeSpace/1GB,2)}}
   ```

2. **Check path permissions:**
   ```cmd
   # Try creating in a different location
   py -3.12 -m venv %TEMP%\test-venv
   ```

3. **Disable antivirus temporarily** (Windows Defender real-time protection)

4. **Run as administrator once** to install required packages

### Venv Uses Wrong Python Version

**Symptom:** Venv is created but uses wrong Python version.

**Diagnostic:**
```cmd
# Check which python is in PATH first
where python

# Check venv python
venvs\whisperx\Scripts\python.exe --version
```

**Solution:** Specify exact version when creating venv:
```cmd
py -3.12 -m venv venvs\whisperx
```

### Package Installation Fails

**Symptom:** pip install fails with compilation errors.

**Solutions:**

1. **Install Build Tools:**
   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools
   ```
   During installation, select:
   - Desktop development with C++
   - Windows 10/11 SDK

2. **Use prebuilt wheels:**
   ```cmd
   pip install --only-binary :all: torch
   ```

3. **Update pip:**
   ```cmd
   venvs\whisperx\Scripts\python.exe -m pip install --upgrade pip
   ```

### PyTorch Installation Issues

**Symptom:** PyTorch fails to install or CUDA not detected.

**Solutions:**

1. **Install CPU version if no NVIDIA GPU:**
   ```cmd
   pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
   ```

2. **Install CUDA version:**
   ```cmd
   # CUDA 11.8
   pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118

   # CUDA 12.1
   pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
   ```

3. **Verify installation:**
   ```python
   import torch
   print(f"PyTorch version: {torch.__version__}")
   print(f"CUDA available: {torch.cuda.is_available()}")
   ```

---

## Audio Issues

### No Audio Devices Detected

**Symptom:** App shows empty audio device list.

**Diagnostic:**
```powershell
# Check Windows Audio service
Get-Service Audiosrv | Select-Object Name, Status

# List audio devices
Get-WmiObject Win32_SoundDevice | Select-Object Name, Status
```

**Solutions:**

1. **Restart audio services:**
   ```powershell
   Restart-Service Audiosrv
   Restart-Service AudioEndpointBuilder
   ```

2. **Update audio drivers:**
   - Open Device Manager
   - Expand "Sound, video and game controllers"
   - Right-click device > Update driver

3. **Check privacy settings:**
   - Settings > Privacy & security > Microphone
   - Enable "Allow apps to access your microphone"

### System Audio Capture Not Working

**Symptom:** Can record microphone but not system audio.

**Cause:** Windows doesn't allow direct system audio capture without a loopback device.

**Solutions:**

1. **Install VB-Audio Virtual Cable:**
   - Download from https://vb-audio.com/Cable/
   - Run installer as Administrator
   - Reboot

2. **Configure VB-Cable:**
   - Open Sound settings
   - Set "CABLE Input" as default playback device
   - In FlowRecap, select "CABLE Output" as recording source
   - Audio from apps will route through VB-Cable

3. **Alternative: Stereo Mix:**
   - Open Sound settings > Recording devices
   - Right-click > Show disabled devices
   - Enable "Stereo Mix" if available
   - Select as recording source in FlowRecap

### Audio Quality Issues

**Symptom:** Recording has static, crackling, or dropouts.

**Solutions:**

1. **Adjust sample rate:**
   - Open Sound settings > Device properties
   - Set sample rate to 16000 Hz (16 kHz)

2. **Close other audio applications**

3. **Disable audio enhancements:**
   - Sound settings > Device properties > Additional device properties
   - Disable all enhancements

4. **Update audio drivers**

### Sox Binary Errors

**Symptom:** "Sox not found" or "Sox failed to start".

**Diagnostic:**
```cmd
# Check if sox is accessible
where sox

# Test sox directly
sox --version
```

**Solutions:**

1. **Verify bundled binaries exist:**
   ```cmd
   dir "%LOCALAPPDATA%\Programs\FlowRecap\resources\binaries\windows\x64"
   ```

2. **Check for missing DLLs:**
   The following DLLs must be present with sox.exe:
   - libsox-3.dll
   - libmad-0.dll
   - libflac-8.dll
   - libvorbis-0.dll
   - libvorbisfile-3.dll
   - libvorbisenc-2.dll
   - libogg-0.dll
   - libmp3lame-0.dll
   - libsndfile-1.dll
   - libgcc_s_sjlj-1.dll
   - libwinpthread-1.dll

3. **Install system sox:**
   ```cmd
   # If bundled version doesn't work, install via chocolatey
   choco install sox.portable
   ```

---

## Path and File Issues

### Long Path Errors

**Symptom:** "The filename or extension is too long" error.

**Cause:** Windows traditionally limits paths to 260 characters.

**Solutions:**

1. **Enable long paths (Windows 10 1607+):**
   ```powershell
   # Run as Administrator
   Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1
   ```

2. **Use shorter installation path**

3. **Move project to root directory:**
   ```cmd
   C:\Dev\FlowRecap  instead of  C:\Users\LongUsername\Documents\Projects\FlowRecap
   ```

### Paths with Spaces

**Symptom:** Commands fail when paths contain spaces.

**Solution:** Always quote paths in commands:
```cmd
# Wrong
cd C:\Program Files\FlowRecap

# Correct
cd "C:\Program Files\FlowRecap"
```

### Non-ASCII Characters in Paths

**Symptom:** Unicode characters in path cause errors.

**Solutions:**

1. **Use ASCII-only paths for installation**

2. **Set UTF-8 code page:**
   ```cmd
   chcp 65001
   ```

3. **Enable Beta UTF-8 support:**
   - Control Panel > Region > Administrative tab
   - Change system locale > Check "Beta: Use Unicode UTF-8"
   - Reboot

### UNC Path Issues

**Symptom:** Network paths (`\\server\share`) not working.

**Cause:** Some applications don't support UNC paths directly.

**Solutions:**

1. **Map network drive:**
   ```cmd
   net use Z: \\server\share
   ```

2. **Use mapped drive letter instead of UNC path**

---

## Performance Issues

### Slow Startup

**Symptom:** App takes more than 10 seconds to start.

**Diagnostic:**
```cmd
# Launch with performance timing
set ELECTRON_ENABLE_LOGGING=true
"%LOCALAPPDATA%\Programs\FlowRecap\FlowRecap.exe"
```

**Solutions:**

1. **Disable antivirus exclusions:**
   Add FlowRecap folder to antivirus exclusions:
   - Windows Defender > Virus & threat protection > Manage settings
   - Add exclusion: `%LOCALAPPDATA%\Programs\FlowRecap`

2. **Clear app cache:**
   ```cmd
   rd /s /q "%APPDATA%\FlowRecap\Cache"
   ```

3. **Check startup programs:**
   - Task Manager > Startup tab
   - Disable unnecessary startup items

### High CPU Usage

**Symptom:** High CPU usage even when not recording.

**Diagnostic:**
```powershell
# Check process CPU usage
Get-Process | Where-Object {$_.Name -like "*FlowRecap*"} | Select-Object Name, CPU, WorkingSet64
```

**Solutions:**

1. **Close DevTools** (Ctrl+Shift+I if open)
2. **Reduce audio monitoring frequency** in settings
3. **Check for runaway Python processes:**
   ```powershell
   Get-Process python* | Stop-Process
   ```

### Memory Leaks

**Symptom:** Memory usage grows over time.

**Diagnostic:**
```powershell
# Monitor memory over time
while ($true) {
    Get-Process FlowRecap | Select-Object WorkingSet64
    Start-Sleep -Seconds 60
}
```

**Solutions:**

1. **Restart app periodically**
2. **Report issue with memory profiling data**
3. **Check for unclosed recordings/transcriptions**

---

## CLI Integration Issues

### Claude CLI Not Found

**Symptom:** "Claude CLI not found" error.

**Diagnostic:**
```cmd
# Check if claude is in PATH
where claude

# Check npm global packages
npm list -g @anthropic-ai/claude-code
```

**Solutions:**

1. **Install Claude CLI:**
   ```cmd
   npm install -g @anthropic-ai/claude-code
   ```

2. **Add npm global to PATH:**
   ```cmd
   setx PATH "%PATH%;%APPDATA%\npm"
   ```

3. **Restart app after PATH changes**

### Cursor CLI Not Found

**Symptom:** "Cursor CLI not found" error.

**Diagnostic:**
```cmd
# Check common locations
dir "%LOCALAPPDATA%\Programs\cursor\cli"
dir "C:\Program Files\Cursor\cli"
```

**Solutions:**

1. **Install Cursor** from https://cursor.sh
2. **Add to PATH via Cursor settings**
3. **Manually add to PATH:**
   ```cmd
   setx PATH "%PATH%;%LOCALAPPDATA%\Programs\cursor\cli"
   ```

---

## Diagnostic Tools

### Collect Diagnostics

Run the built-in diagnostic collector:

```cmd
# Full diagnostics
node scripts\collect-windows-diagnostics.js --verbose

# Python only
node scripts\collect-windows-diagnostics.js --python-only --verbose

# Include event logs (slower)
node scripts\collect-windows-diagnostics.js --include-logs --verbose
```

Output file: `windows-diagnostics.json`

### Manual System Information

```powershell
# System info
systeminfo | Select-String "OS Name|OS Version|System Type|Total Physical Memory"

# Python installations
py --list
where python

# Audio devices
Get-WmiObject Win32_SoundDevice | Select-Object Name, Status

# PATH
$env:PATH -split ';'

# Disk space
Get-WmiObject Win32_LogicalDisk | Where-Object {$_.DriveType -eq 3} |
    Select-Object DeviceID, @{N='FreeGB';E={[math]::Round($_.FreeSpace/1GB,2)}}
```

### Event Viewer

For crash investigation:
1. Open Event Viewer (`eventvwr.msc`)
2. Navigate to: Windows Logs > Application
3. Filter by: Source = "Application Error" or "FlowRecap"

### Process Monitor

For detailed file/registry access issues:
1. Download Process Monitor from Microsoft
2. Filter by process name "FlowRecap.exe" or "python.exe"
3. Look for "ACCESS DENIED" or "PATH NOT FOUND" results

---

## Getting Help

If issues persist after trying these solutions:

1. **Collect diagnostics:**
   ```cmd
   node scripts\collect-windows-diagnostics.js --verbose --include-logs
   ```

2. **Check console errors:**
   - Launch app
   - Press Ctrl+Shift+I
   - Go to Console tab
   - Copy any red error messages

3. **Submit issue:**
   - Include `windows-diagnostics.json`
   - Include console errors
   - Include steps to reproduce
   - Include Windows version and build number

---

## Quick Reference

| Issue | Quick Fix |
|-------|-----------|
| SmartScreen warning | Click "More info" > "Run anyway" |
| Missing DLLs | `winget install Microsoft.VCRedist.2015+.x64` |
| Python not found | `winget install Python.Python.3.12` |
| Audio service stopped | `Restart-Service Audiosrv` |
| Long path error | Enable LongPathsEnabled in registry |
| Claude CLI not found | `npm install -g @anthropic-ai/claude-code` |
| High memory usage | Restart app, check for runaway processes |
