# Windows Local Testing Environment Setup Guide

This guide provides comprehensive instructions for setting up a local Windows testing environment for FlowRecap development and QA testing.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setting Up a Windows VM](#setting-up-a-windows-vm)
3. [Development Environment Setup](#development-environment-setup)
4. [Python Environment Configuration](#python-environment-configuration)
5. [Audio Testing Setup](#audio-testing-setup)
6. [Running Tests](#running-tests)
7. [Debugging Windows Issues](#debugging-windows-issues)
8. [CI/CD Testing](#cicd-testing)

---

## Prerequisites

### Hardware Requirements

- **CPU:** 4+ cores recommended (for VM)
- **RAM:** 16GB+ recommended (8GB minimum)
- **Storage:** 100GB+ free space for Windows VM
- **Virtualization:** Intel VT-x or AMD-V enabled in BIOS

### Software Requirements

- **Host OS:** macOS 10.15+, Linux (Ubuntu 20.04+), or Windows 10/11
- **Virtualization Software:** One of:
  - [VirtualBox](https://www.virtualbox.org/) (free, cross-platform)
  - [Hyper-V](https://docs.microsoft.com/en-us/virtualization/hyper-v-on-windows/) (Windows Pro/Enterprise)
  - [Parallels Desktop](https://www.parallels.com/) (macOS, paid)
  - [VMware Fusion](https://www.vmware.com/products/fusion.html) (macOS, paid)
  - [UTM](https://mac.getutm.app/) (macOS, Apple Silicon compatible)

---

## Setting Up a Windows VM

### Option 1: VirtualBox (Recommended for Cross-Platform)

1. **Download VirtualBox**
   ```bash
   # macOS (with Homebrew)
   brew install --cask virtualbox

   # Ubuntu
   sudo apt install virtualbox
   ```

2. **Get Windows 11 ISO**
   - Download from [Microsoft's official site](https://www.microsoft.com/software-download/windows11)
   - Or use [Windows 11 Development Environment](https://developer.microsoft.com/windows/downloads/virtual-machines/) (pre-configured VM)

3. **Create VM**
   ```
   Name: FlowRecap-Windows-Test
   Type: Microsoft Windows
   Version: Windows 11 (64-bit)
   Memory: 8192 MB (8GB minimum)
   Hard disk: 80 GB (VDI, dynamically allocated)
   Processors: 4 CPUs
   Video Memory: 128 MB
   Enable 3D Acceleration: Yes
   ```

4. **VM Settings**
   - **System → Processor:** Enable PAE/NX
   - **System → Acceleration:** Enable VT-x/AMD-V, Nested Paging
   - **Display:** Enable 3D Acceleration
   - **Storage:** Attach Windows ISO to optical drive
   - **Network:** NAT or Bridged Adapter
   - **Shared Folders:** Add your project directory

5. **Install Windows**
   - Boot from ISO
   - Select "I don't have a product key" (valid for testing)
   - Choose Windows 11 Pro
   - Complete installation

6. **Install Guest Additions**
   - Devices → Insert Guest Additions CD
   - Run `VBoxWindowsAdditions.exe`
   - Reboot

### Option 2: Hyper-V (Windows Host Only)

1. **Enable Hyper-V**
   ```powershell
   # Run as Administrator
   Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
   ```

2. **Create Quick Create VM**
   - Open Hyper-V Manager
   - Quick Create → Windows 11 dev environment
   - Or use your own ISO

3. **Configure VM**
   - Minimum 8GB RAM
   - 4 virtual processors
   - Enhanced Session Mode enabled

### Option 3: UTM (macOS Apple Silicon)

1. **Install UTM**
   ```bash
   brew install --cask utm
   ```

2. **Download Windows 11 ARM**
   - Download from [Windows Insider Preview Downloads](https://www.microsoft.com/software-download/windowsinsiderpreviewarm64)

3. **Create VM in UTM**
   - New VM → Virtualize → Windows
   - Import VHDX or use ISO
   - Configure 8GB RAM, 4 CPU cores

---

## Development Environment Setup

### 1. Install Node.js

```powershell
# Using winget (Windows 11)
winget install OpenJS.NodeJS.LTS

# Or download from https://nodejs.org/
# Choose LTS version (v20.x)
```

Verify installation:
```cmd
node --version
npm --version
```

### 2. Install Git

```powershell
winget install Git.Git
```

Configure Git:
```cmd
git config --global core.autocrlf false
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### 3. Install Python 3.12

```powershell
# Using winget
winget install Python.Python.3.12

# Or download from https://www.python.org/downloads/
```

**Important Installation Options:**
- ✅ Add Python to PATH
- ✅ Install pip
- ✅ Install py launcher

Verify installation:
```cmd
python --version
py --list
pip --version
```

### 4. Install Visual Studio Build Tools

Required for native Node.js modules (better-sqlite3, etc.):

```powershell
# Using winget
winget install Microsoft.VisualStudio.2022.BuildTools

# Or download from:
# https://visualstudio.microsoft.com/visual-cpp-build-tools/
```

During installation, select:
- ✅ Desktop development with C++
- ✅ Windows 10/11 SDK

### 5. Clone and Setup Project

```cmd
# Clone repository
git clone <repository-url> "C:\Dev\FlowRecap"
cd "C:\Dev\FlowRecap"

# Install dependencies
npm install

# Build the project
npm run build:vite
```

---

## Python Environment Configuration

### 1. Verify Python Installation

```cmd
# Check py launcher
py --list

# Check python command
python --version

# Check pip
pip --version
```

### 2. Create Virtual Environments

FlowRecap requires two virtual environments:

```cmd
# Navigate to project
cd "C:\Dev\FlowRecap"

# Create whisperx venv
py -3.12 -m venv venvs\whisperx

# Create pyannote venv
py -3.12 -m venv venvs\pyannote
```

### 3. Install Python Dependencies

```cmd
# Activate whisperx venv
venvs\whisperx\Scripts\activate.bat

# Install whisperx dependencies
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
pip install whisperx

# Deactivate
deactivate

# Activate pyannote venv
venvs\pyannote\Scripts\activate.bat

# Install pyannote dependencies
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
pip install pyannote.audio

# Deactivate
deactivate
```

### 4. Configure HuggingFace Token

For pyannote model downloads:

```cmd
# Set environment variable
setx HF_TOKEN "your_huggingface_token"

# Or in PowerShell
[Environment]::SetEnvironmentVariable("HF_TOKEN", "your_token", "User")
```

### 5. Verify Python Setup

Run the setup verification:

```cmd
# Run batch setup script
python\setup_environments.bat

# Or run diagnostics
node scripts\collect-windows-diagnostics.js --verbose --python-only
```

---

## Audio Testing Setup

### 1. Install VB-Audio Virtual Cable

For system audio capture testing:

1. Download from [VB-Audio](https://vb-audio.com/Cable/)
2. Run installer as Administrator
3. Reboot
4. Verify in Sound Settings → "CABLE Input" appears

### 2. Configure Audio Devices

```powershell
# List audio devices
Get-WmiObject Win32_SoundDevice | Select-Object Name, Status
```

### 3. Test Audio Recording

In the app or via command line:
```cmd
# Test sox (if installed)
sox -d test.wav trim 0 5

# Test ffmpeg (if installed)
ffmpeg -f dshow -i audio="Microphone" -t 5 test.wav
```

---

## Running Tests

### 1. Install Playwright

```cmd
npm install
npx playwright install chromium
```

### 2. Run Windows-Specific Tests

```cmd
# Run all Windows tests
npx playwright test tests/windows/ --reporter=list

# Run specific test file
npx playwright test tests/windows/windows-features.spec.ts

# Run with UI mode
npx playwright test --ui
```

### 3. Run Production Tests

```cmd
# Build first
npm run build:vite
npm run build:win

# Run production tests
npx playwright test tests/production/ --reporter=list
```

### 4. Run Manual Test Checklist

See [MANUAL_TESTING_CHECKLIST.md](./MANUAL_TESTING_CHECKLIST.md) for comprehensive manual testing procedures.

### 5. Collect Diagnostics

```cmd
# Full diagnostics
node scripts\collect-windows-diagnostics.js --verbose

# Python only
node scripts\collect-windows-diagnostics.js --python-only --verbose

# With event logs (slower)
node scripts\collect-windows-diagnostics.js --include-logs --verbose
```

---

## Debugging Windows Issues

### Common Issues

#### 1. "python" command not found

```cmd
# Check Python installation
py --list

# Add Python to PATH manually
setx PATH "%PATH%;C:\Users\<user>\AppData\Local\Programs\Python\Python312"
```

#### 2. Native module build failures

```cmd
# Install Windows Build Tools
npm install --global windows-build-tools

# Or configure npm to use specific MSVS version
npm config set msvs_version 2022
```

#### 3. Long path issues

Enable long paths in registry:
```powershell
# Run as Administrator
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1
```

#### 4. Audio device not detected

```powershell
# Check Windows Audio service
Get-Service Audiosrv | Select-Object Name, Status

# Restart audio service
Restart-Service Audiosrv
```

### Debug Logging

Enable detailed logging:
```cmd
set DEBUG=electron*
npm run dev
```

### Using DevTools

1. Launch app
2. Press `Ctrl+Shift+I` to open DevTools
3. Check Console for errors
4. Check Network tab for failed requests

---

## CI/CD Testing

### Running Tests Locally Like CI

```cmd
# Set CI environment
set CI=true

# Run tests
npx playwright test tests/windows/ --reporter=list
```

### Testing Installer

```cmd
# Build Windows installer
npm run dist:win

# Find installer in release folder
dir release\*.exe
```

### Simulating CI Environment

1. Create fresh Windows VM
2. Install only Node.js and Git
3. Clone repository
4. Run `npm ci`
5. Run tests

This simulates the GitHub Actions `windows-latest` runner.

---

## Test Scenarios

### Scenario 1: Fresh Install (No Python)

1. Fresh Windows VM
2. Install only Node.js
3. Clone project
4. Run `npm install`
5. Verify Python detection fails gracefully
6. Install Python 3.12
7. Verify Python detection works

### Scenario 2: Existing Python Installation

1. Windows with Python 3.11 installed
2. Clone project
3. Verify py launcher lists versions
4. Run tests
5. Verify correct Python version selected

### Scenario 3: Conflicting Packages

1. Windows with Python 3.12
2. Install conflicting packages globally:
   ```cmd
   pip install torch==1.9.0 numpy==1.19.0
   ```
3. Clone project
4. Create venvs
5. Verify venv isolation works

### Scenario 4: Non-ASCII Username

1. Create Windows user with non-ASCII name (e.g., "テスト")
2. Login as that user
3. Clone project to user's home directory
4. Run tests
5. Verify path handling works

### Scenario 5: Network Drive

1. Map network drive (or use localhost UNC path)
2. Clone project to network location
3. Run tests
4. Verify path handling works with UNC paths

---

## Troubleshooting Checklist

- [ ] Node.js v20+ installed
- [ ] Python 3.12 installed with py launcher
- [ ] Visual C++ Build Tools installed
- [ ] Git configured with `autocrlf=false`
- [ ] Long paths enabled in registry
- [ ] HF_TOKEN set for pyannote models
- [ ] VB-Audio installed (for audio testing)
- [ ] Playwright browsers installed

---

## Resources

- [Windows Compatibility Audit](./WINDOWS_COMPATIBILITY_AUDIT.md)
- [Manual Testing Checklist](./MANUAL_TESTING_CHECKLIST.md)
- [Windows Troubleshooting Guide](./WINDOWS_TROUBLESHOOTING.md)
- [GitHub Actions Windows Runner Docs](https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners#supported-runners-and-hardware-resources)
