---
title: Console Output Guide
description: Understanding console messages and logs in FlowRecap during development
tags:
  - development
  - debugging
  - console
  - logging
  - transcription
lastUpdated: true
prev:
  text: 'Implementation Notes'
  link: '/development/IMPLEMENTATION_NOTES'
next:
  text: 'Manual Testing Checklist'
  link: '/development/MANUAL_TESTING_CHECKLIST'
---

# Console Output Guide

This document explains the various console messages you'll see when running the Meeting Notes application, particularly during live transcription.

## Table of Contents
1. [Normal Operation Messages](#normal-operation-messages)
2. [Filtering Messages](#filtering-messages)
3. [Known Harmless Errors](#known-harmless-errors)
4. [Debugging Tips](#debugging-tips)

---

## Normal Operation Messages

### Protocol Handler Messages
```
[Protocol Handler] Serving audio file: /path/to/file.wav MIME type: audio/wav Size: 4571180
```
**What it means:** The Electron protocol handler is serving an audio file to the browser for playback. This is normal during recording playback.

### Live Transcription Messages

#### Model Loading
```
[Live Transcription] Model loaded and ready for streaming
[Live Transcription] VAD: enabled, Confidence threshold: 0.3
```
**What it means:** WhisperX transcription model has loaded successfully. VAD (Voice Activity Detection) is enabled to skip silent sections.

#### Transcription Output
```
✅ [Whisper Output] Transcribed segment: 'Hello, this is a test...' (start: 0.50s, end: 3.25s, confidence: 0.85)
```
**What it means:** Successfully transcribed audio segment with timing and confidence score. The emoji prefix helps categorize output:
- ✅ = Successfully transcribed segment
- 🔍 = Debug information
- 🔴 = Filtered segment
- 🎤 = Voice Activity Detection

#### Debug Information
```
🔍 [Whisper Debug] WhisperX returned result with 1 segments
🔍 [Whisper Debug] Raw result keys: dict_keys(['segments', 'language'])
```
**What it means:** Internal debugging information from the WhisperX transcription engine. Shows what data structures are being processed.

---

## Filtering Messages

The transcription system automatically filters out hallucinations and low-quality segments. This is **normal and expected behavior**.

### Hallucination Filtering
```
🔴 [Filter] Hallucination detected and filtered: 'Thanks for watching...'
```
**What it means:** WhisperX sometimes "hallucinates" common phrases when:
- Audio quality is poor
- There's background noise
- Long silences occur
- No actual speech is present

Common hallucinated phrases that are automatically filtered:
- "Thanks for watching"
- "Please subscribe"
- "[music]" or "♪"
- Repetitive patterns like "la la la"
- Other YouTube/video common phrases

**This is working correctly** - these phrases are being caught before they pollute your transcript.

### Low Confidence Filtering
```
🔴 [Filter] Low confidence (0.25): 'unclear mumbling...'
```
**What it means:** The transcription model had low confidence (< 0.3) in what it heard. These segments are filtered to maintain transcript quality.

### Voice Activity Detection (VAD)
```
🎤 [VAD] No voice detected, skipping chunk
```
**What it means:** VAD detected silence or no speech activity in the audio chunk, so transcription was skipped to save resources.

---

## Known Harmless Errors

### macOS SetApplicationIsDaemon Error
```
[64158:0110/220118.557534:ERROR:system_services.cc(34)] SetApplicationIsDaemon: Error Domain=NSOSStatusErrorDomain Code=-50 "paramErr: error in user parameter list" (-50)
```
**What it means:** This is a **harmless** macOS/Electron internal error. It occurs when Electron tries to set daemon status but the parameter format is invalid.

**Impact:** None - the application functions normally despite this message.

**Why it happens:** Known Electron/macOS compatibility issue with certain system calls.

**Action required:** None - you can safely ignore this error.

---

## Debugging Tips

### Understanding the Output Flow

1. **Audio Recording** → audioRecorderService captures audio
2. **Audio Chunks** → Split into 5-second chunks
3. **VAD Check** → Silero VAD detects if speech is present
4. **Transcription** → WhisperX processes audio → generates text
5. **Filtering** → Hallucination and confidence filtering
6. **Deduplication** → Removes overlapping words between chunks
7. **Output** → Clean transcription sent to UI

### Common Patterns

#### Successful Transcription Session
```
[Live Transcription] Model loaded and ready for streaming
✅ [Whisper Output] Transcribed segment: 'Hello world' (start: 0.5s, end: 1.2s, confidence: 0.92)
✅ [Whisper Output] Transcribed segment: 'How are you?' (start: 1.5s, end: 2.8s, confidence: 0.88)
```

#### Noisy Audio with Filtering
```
[Live Transcription] Model loaded and ready for streaming
🔴 [Filter] Hallucination detected and filtered: 'Thanks for watching'
🔍 [Whisper Debug] WhisperX returned result with 1 segments
✅ [Whisper Output] Transcribed segment: 'Actual speech here' (start: 5.0s, end: 7.5s, confidence: 0.87)
```

#### Silent Period
```
🎤 [VAD] No voice detected, skipping chunk
🎤 [VAD] No voice detected, skipping chunk
✅ [Whisper Output] Transcribed segment: 'Speech resumes' (start: 15.0s, end: 16.2s, confidence: 0.91)
```

### Enable Additional Debugging

If you need more detailed logs, check:

1. **Electron DevTools Console** - View → Toggle Developer Tools
2. **Python stderr output** - All Python logs are forwarded to the main console
3. **Audio diagnostics** - Check audio levels and health indicators

### Troubleshooting

| Issue | What to Look For |
|-------|-----------------|
| No transcription appearing | Check for VAD skipping all chunks (no voice detected) |
| Only hallucinations showing | All segments being filtered - check audio input source |
| Transcription cut off | Check for "... [truncated]" - full text is still sent to UI |
| Poor accuracy | Look for low confidence scores (< 0.3) being filtered |

### Performance Notes

- **Chunk duration:** 5 seconds (default)
- **Model size:** "base" for live transcription (faster, lower latency)
- **Confidence threshold:** 0.3 (permissive to allow most speech)
- **VAD threshold:** 0.5 for microphone, 0.3 for system audio (permissive mode)

---

## Summary

Most console output is **informational and expected**. The key things to remember:

✅ **Normal:** Filtered hallucinations, VAD skips, WhisperX debug output
✅ **Normal:** macOS SetApplicationIsDaemon error
⚠️ **Check:** Consistent low confidence scores
❌ **Error:** Python process crashes, model loading failures

The transcription system is designed to be **self-correcting** - it actively filters out noise and hallucinations to provide clean transcripts.
