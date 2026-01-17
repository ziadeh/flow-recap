# Manual Testing Checklist for Meeting Notes

This document provides a comprehensive manual testing checklist for QA testing of the Meeting Notes application across all supported platforms.

## Table of Contents

1. [Pre-Testing Requirements](#pre-testing-requirements)
2. [Installation Testing](#installation-testing)
3. [Core Feature Testing](#core-feature-testing)
4. [Audio Device Testing](#audio-device-testing)
5. [Recording Workflow Testing](#recording-workflow-testing)
6. [Transcription Testing](#transcription-testing)
7. [Database Operations Testing](#database-operations-testing)
8. [UI/UX Testing](#uiux-testing)
9. [Performance Testing](#performance-testing)
10. [Integration Testing](#integration-testing)
11. [Platform-Specific Testing](#platform-specific-testing)
12. [Known Issues and Workarounds](#known-issues-and-workarounds)

---

## Pre-Testing Requirements

### Test Environment Setup

- [ ] Clean virtual machine or fresh system install
- [ ] No previous version of Meeting Notes installed
- [ ] Audio input device (microphone) available
- [ ] Audio output device (speakers/headphones) available
- [ ] Stable internet connection (for ML features)
- [ ] At least 4GB RAM available
- [ ] At least 1GB free disk space

### Test Versions

- [ ] Note the app version being tested: `_____________`
- [ ] Note the OS version: `_____________`
- [ ] Note the system architecture (x64/arm64): `_____________`

---

## Installation Testing

### macOS Installation

- [ ] DMG file downloads successfully
- [ ] DMG mounts without errors
- [ ] App can be dragged to Applications folder
- [ ] App launches on first run
- [ ] Gatekeeper/security prompts handled correctly
- [ ] App appears in Launchpad
- [ ] App appears in Spotlight search
- [ ] No "damaged app" warnings (notarization check)

### Windows Installation

- [ ] Installer (.exe) downloads successfully
- [ ] Installer runs without admin rights (or prompts correctly)
- [ ] Installation directory can be changed
- [ ] Desktop shortcut created
- [ ] Start menu shortcut created
- [ ] App launches after installation
- [ ] No missing DLL errors
- [ ] Uninstaller works correctly

### Linux Installation

#### AppImage
- [ ] AppImage downloads successfully
- [ ] AppImage has executable permissions
- [ ] AppImage launches correctly
- [ ] Desktop integration offered

#### Debian/Ubuntu (.deb)
- [ ] Package installs via dpkg or apt
- [ ] Dependencies resolved automatically
- [ ] App appears in application menu
- [ ] .desktop file properly integrated

#### Fedora/RHEL (.rpm)
- [ ] Package installs via dnf or rpm
- [ ] Dependencies resolved
- [ ] App launches from menu

#### Snap
- [ ] Snap installs from store or local file
- [ ] Proper confinement permissions
- [ ] Audio access works

---

## Core Feature Testing

### App Startup

- [ ] App starts without crashes
- [ ] Splash screen (if any) displays correctly
- [ ] Main window appears within 10 seconds
- [ ] Window is properly sized and positioned
- [ ] No console errors on startup (check DevTools)
- [ ] Previous session state restored (if applicable)

### Navigation

- [ ] All main navigation items are visible
- [ ] Dashboard/Home page loads
- [ ] Meetings list page loads
- [ ] Tasks page loads
- [ ] Settings page loads
- [ ] Navigation state persists correctly

### Window Management

- [ ] Window can be resized
- [ ] Minimum window size enforced
- [ ] Window can be maximized
- [ ] Window can be minimized
- [ ] Window state persists on restart
- [ ] Multiple windows (if supported) work correctly

---

## Audio Device Testing

### Device Detection

- [ ] Microphone devices are listed
- [ ] System audio devices detected
- [ ] Default device selected correctly
- [ ] Device list refreshes when devices change
- [ ] Disconnecting device handled gracefully

### Device Selection

- [ ] Can select different microphone
- [ ] Can select system audio source
- [ ] Device selection persists across restarts
- [ ] Invalid device selection shows error

### Audio Level Monitoring

- [ ] Audio level meter displays
- [ ] Meter responds to audio input
- [ ] No clipping/distortion at high levels
- [ ] Meter works for different devices

---

## Recording Workflow Testing

### Pre-Recording

- [ ] Can create new meeting
- [ ] Meeting title can be set
- [ ] Audio device can be selected
- [ ] Recording settings accessible

### During Recording

- [ ] Recording starts successfully
- [ ] Recording indicator visible
- [ ] Timer/duration displayed
- [ ] Audio level monitoring works
- [ ] Can pause recording (if supported)
- [ ] Can resume recording (if supported)
- [ ] UI remains responsive during recording

### Post-Recording

- [ ] Recording stops successfully
- [ ] Audio file saved correctly
- [ ] Audio file plays back correctly
- [ ] Meeting saved to database
- [ ] Recording duration accurate
- [ ] File size reasonable for duration

### Error Handling

- [ ] No audio device - shows error
- [ ] Disk full - handled gracefully
- [ ] Device disconnection during recording - handled
- [ ] App crash recovery - recording saved if possible

---

## Transcription Testing

### Live Transcription

- [ ] Live transcription starts with recording
- [ ] Text appears in real-time
- [ ] Text is reasonably accurate
- [ ] Speaker labels displayed (if enabled)
- [ ] No significant lag
- [ ] Transcription can be paused/resumed

### Post-Recording Transcription

- [ ] Transcription runs after recording stops
- [ ] Progress indicator displayed
- [ ] Transcription completes successfully
- [ ] Results saved to database
- [ ] Can re-run transcription

### Transcription Quality

- [ ] English speech recognized accurately
- [ ] Punctuation added appropriately
- [ ] Speaker changes detected
- [ ] Background noise handled
- [ ] Multiple speakers distinguished

---

## Database Operations Testing

### Meeting Management

- [ ] Create new meeting
- [ ] View meeting details
- [ ] Edit meeting title
- [ ] Delete meeting
- [ ] Delete confirmation shown
- [ ] Deleted data removed completely

### Task Management

- [ ] Create task from meeting
- [ ] View task list
- [ ] Edit task
- [ ] Mark task complete
- [ ] Delete task
- [ ] Filter tasks

### Data Persistence

- [ ] Data persists after app restart
- [ ] Data survives system restart
- [ ] No data corruption observed
- [ ] Database backups (if available)

### Search

- [ ] Search meetings by title
- [ ] Search transcripts
- [ ] Search results accurate
- [ ] No search performance issues

---

## UI/UX Testing

### Visual Design

- [ ] All text readable
- [ ] Icons display correctly
- [ ] Colors consistent
- [ ] Dark/light mode (if supported)
- [ ] No visual glitches

### Responsiveness

- [ ] UI responds to clicks immediately
- [ ] No frozen UI states
- [ ] Loading indicators shown
- [ ] Animations smooth (60fps)

### Accessibility

- [ ] Keyboard navigation works
- [ ] Tab order logical
- [ ] Screen reader compatible (if applicable)
- [ ] Sufficient color contrast

### Error Messages

- [ ] Error messages clear and helpful
- [ ] Errors don't crash app
- [ ] Recovery options provided
- [ ] Technical details available for debugging

---

## Performance Testing

### Startup Performance

- [ ] Cold start time: _____ seconds
- [ ] Warm start time: _____ seconds
- [ ] Time to first interaction: _____ seconds

### Runtime Performance

- [ ] Memory usage at idle: _____ MB
- [ ] Memory usage during recording: _____ MB
- [ ] CPU usage at idle: _____ %
- [ ] CPU usage during recording: _____ %

### Long-Running Tests

- [ ] 1-hour recording stable
- [ ] No memory leaks over time
- [ ] No performance degradation
- [ ] App stable over 24 hours (background)

### Storage

- [ ] Database size reasonable
- [ ] Audio files compressed appropriately
- [ ] Old data can be archived/deleted
- [ ] Disk cleanup available

---

## Integration Testing

### Claude CLI Integration

- [ ] Claude CLI detected correctly
- [ ] Settings for Claude CLI accessible
- [ ] Integration enabled/disabled properly
- [ ] Claude CLI features work (if available)
- [ ] Error handling when CLI not available

### Cursor CLI Integration

- [ ] Cursor CLI detected correctly
- [ ] Settings accessible
- [ ] Integration works as expected
- [ ] Error handling implemented

### External Services

- [ ] API connections work
- [ ] API errors handled gracefully
- [ ] Offline mode (if supported) works
- [ ] Network reconnection handled

### Export/Import

- [ ] Export meeting data
- [ ] Export transcripts
- [ ] Export formats correct
- [ ] Import data (if supported)

---

## Platform-Specific Testing

### macOS-Specific

- [ ] Native menu bar integration
- [ ] Dock icon behavior correct
- [ ] Touch Bar support (if applicable)
- [ ] Microphone permission requested
- [ ] Screen recording permission (if needed)
- [ ] Notarization intact (no security warnings)
- [ ] Universal binary works on Intel and Apple Silicon

### Windows-Specific

- [ ] Start menu integration
- [ ] System tray icon (if applicable)
- [ ] Windows notifications work
- [ ] File associations (if any)
- [ ] Registry entries correct
- [ ] Works on Windows 10
- [ ] Works on Windows 11

### Linux-Specific

- [ ] Desktop file integration
- [ ] System tray (if applicable)
- [ ] Notifications via D-Bus
- [ ] XDG directories used correctly
- [ ] Works with Wayland
- [ ] Works with X11
- [ ] PulseAudio integration
- [ ] PipeWire compatibility

---

## Known Issues and Workarounds

### macOS

| Issue | Workaround | Status |
|-------|------------|--------|
| GPU process crash on startup | Hardware acceleration disabled by default | Fixed |
| Gatekeeper warning for unsigned builds | Right-click > Open | Expected for dev builds |
| Microphone permission denied | System Preferences > Security > Privacy > Microphone | User action required |

### Windows

| Issue | Workaround | Status |
|-------|------------|--------|
| SmartScreen warning for unsigned builds | Click "More info" > "Run anyway" | Expected for dev builds |
| Missing Visual C++ Runtime | Install VC++ Redistributable | May require manual install |
| Audio device not detected | Update audio drivers | Driver issue |

### Linux

| Issue | Workaround | Status |
|-------|------------|--------|
| AppImage not executable | Run `chmod +x Meeting*.AppImage` | Manual step required |
| No audio on Wayland | Use PipeWire or PulseAudio | System configuration |
| Sandbox issues with Snap | Use --devmode or AppImage instead | Snap limitation |
| Missing libraries | Install dependencies via package manager | System-specific |

---

## Test Sign-Off

### Tester Information

- **Tester Name:** ____________________
- **Date:** ____________________
- **App Version:** ____________________
- **Platform/OS:** ____________________

### Test Summary

- **Total Tests Run:** _____
- **Tests Passed:** _____
- **Tests Failed:** _____
- **Tests Skipped:** _____

### Critical Issues Found

| Issue | Severity | Steps to Reproduce |
|-------|----------|-------------------|
| | | |
| | | |
| | | |

### Recommendations

- [ ] Ready for release
- [ ] Minor issues - release with known issues documented
- [ ] Major issues - requires fixes before release
- [ ] Critical issues - do not release

### Notes

```
Additional notes and observations:





```

---

## Appendix: Console Error Checking

To check for console errors:

1. **macOS/Linux:** Launch from terminal: `/Applications/Meeting Notes.app/Contents/MacOS/Meeting\ Notes`
2. **Windows:** Launch from cmd: `"C:\Program Files\Meeting Notes\Meeting Notes.exe"`
3. **DevTools:** Press `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (macOS)

### Expected Console Messages (Non-Errors)

- Electron DevTools warnings (can be ignored)
- "GPU process exited" messages if hardware acceleration disabled
- React development mode warnings (if dev build)

### Error Indicators to Report

- `Uncaught TypeError`
- `Unhandled Promise Rejection`
- `FATAL ERROR`
- `Cannot find module`
- Any red error messages
