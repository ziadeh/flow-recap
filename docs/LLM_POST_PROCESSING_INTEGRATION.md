# LLM Post-Processing Integration Guide

## Overview

The LLM post-processing service has been successfully integrated into the diarization pipeline. It uses LM Studio (running locally on `http://localhost:1234`) to enhance speaker consistency, resolve overlapping speech, and handle low-confidence diarization segments.

## Integration Points

The LLM service is automatically called at these points in the pipeline:

### 1. Diarization-First Pipeline (`diarizationFirstPipeline.ts`)
- **When**: After diarization validation succeeds, before transcription starts
- **Phase**: Phase 3.5 (added between diarization validation and transcription)
- **Purpose**: Post-processes raw diarization output to improve speaker consistency

### 2. Batch Diarization Service (`batchDiarizationService.ts`)
- **When**: After diarization completes for a meeting with existing transcripts
- **Purpose**: Enhances speaker labels and can generate speaker-aware summaries

## How to Verify It's Working

### Step 1: Start LM Studio

1. Open LM Studio application
2. Load a model (any chat model will work)
3. Start the local server (should be on port 1234 by default)
4. Verify the server is running by visiting `http://localhost:1234/v1/models` in your browser

### Step 2: Check the Logs

When you run a diarization process, you should see logs like:

```
[DiarizationFirstPipeline] Checking LM Studio availability for post-processing...
[Main] llmPostProcessing:checkAvailability - Checking LM Studio at http://localhost:1234
[Main] llmPostProcessing:checkAvailability result: { available: true, modelInfo: '...' }
[DiarizationFirstPipeline] LM Studio available (...), processing diarization output...
[Main] llmPostProcessing:processOutput - Starting LLM processing
[DiarizationFirstPipeline] LLM post-processing complete: {
  speakerMappings: 2,
  overlapResolutions: 1,
  lowConfidenceResolutions: 3,
  llmRequests: 4,
  processingTime: 2345,
  guardrailViolations: 0
}
[Main] llmPostProcessing:processOutput - Completed in 2345 ms
```

### Step 3: Watch for LLM Activity

During processing, you should see:

1. **In the Electron Console** (Electron app logs):
   - `[Main] llmPostProcessing:checkAvailability` - Checking if LM Studio is available
   - `[Main] llmPostProcessing:processOutput` - Processing diarization output
   - Detailed results showing speaker mappings, overlap resolutions, etc.

2. **In LM Studio**:
   - Activity in the server tab showing incoming requests
   - Requests to `/v1/chat/completions`
   - Token usage statistics

3. **In the Diarization Pipeline**:
   - Progress messages about LLM post-processing
   - Results showing overlap resolutions and low-confidence segment handling

## What the LLM Does

### 1. Speaker Identity Mapping
- Maintains consistent speaker IDs across different segments
- Tracks speaker characteristics based on temporal patterns

### 2. Overlap Resolution
- When multiple speakers talk simultaneously, the LLM suggests which speaker should be considered primary
- Uses temporal context (who spoke before/after) to make decisions

### 3. Low-Confidence Segment Resolution
- For segments where diarization confidence is low (< 0.6), the LLM analyzes context
- Suggests alternative speaker assignments based on conversation patterns

### 4. Display Order Recommendations
- Recommends how to order speakers in the UI
- Typically based on speaking duration and first appearance

### 5. Speaker-Aware Summaries (Batch Mode Only)
- Generates action items and key points attributed to specific speakers
- Only when transcription is available

## Guardrails

The LLM is strictly constrained by guardrails that prevent it from:

❌ **MUST NOT**:
- Extract speaker embeddings from audio
- Decide speaker identity from transcribed text alone
- Create speaker IDs without diarization data
- Override high-confidence diarization results (>0.85)

✅ **MAY**:
- Maintain speaker identity mappings across sessions
- Resolve overlapping speech segments
- Handle low-confidence diarization segments
- Assist UI decisions about speaker display order
- Generate speaker-aware summaries

## Non-Blocking Behavior

The LLM post-processing is **non-blocking**:
- If LM Studio is not running, diarization still succeeds
- If LLM processing fails, the pipeline continues with raw diarization output
- Any LLM errors are logged but don't halt the pipeline

You'll see messages like:
```
[DiarizationFirstPipeline] LM Studio not available, skipping post-processing: Cannot connect to LM Studio at http://localhost:1234
```

This is expected behavior when LM Studio is not running.

## Configuration

### Default Settings

```typescript
{
  baseUrl: 'http://localhost:1234',
  maxTokens: 2048,
  temperature: 0.3,  // Lower = more consistent
  timeout: 30000,
  
  lowConfidenceThreshold: 0.6,   // Below this, LLM may process
  highConfidenceThreshold: 0.85, // Above this, LLM must not override
  minOverlapDuration: 0.3        // 300ms minimum overlap
}
```

### Changing Configuration

You can update the configuration via IPC:

```typescript
// Update LM Studio URL
window.electronAPI.llmPostProcessing.updateConfig({
  baseUrl: 'http://192.168.1.100:1234',
  temperature: 0.5
})

// Update confidence thresholds
window.electronAPI.llmPostProcessing.updateThresholds({
  lowConfidenceThreshold: 0.5,
  highConfidenceThreshold: 0.9
})
```

## Troubleshooting

### LLM Service Not Being Called

If you don't see any LLM logs:

1. **Check if diarization succeeded first**
   - LLM is only called after successful diarization
   - Look for: `[DiarizationFirstPipeline] Checking LM Studio availability`

2. **Verify the integration is in the right place**
   - Should be in `diarizationFirstPipeline.ts` after line 582
   - Should be in `batchDiarizationService.ts` after line 145

3. **Check your build**
   - Make sure TypeScript compiled successfully
   - Restart the Electron app to pick up changes

### LM Studio Not Connecting

If logs show connection errors:

1. **Verify LM Studio is running**
   - Open LM Studio
   - Go to "Local Server" tab
   - Click "Start Server"
   - Default port should be 1234

2. **Test the endpoint manually**
   ```bash
   curl http://localhost:1234/v1/models
   ```

3. **Check firewall settings**
   - Ensure localhost connections are allowed

### LLM Returns Errors

If LLM is called but returns errors:

1. **Check model is loaded in LM Studio**
   - A model must be loaded for the server to work
   - Any chat model will work

2. **Review guardrail violations**
   - Check logs for guardrail violation messages
   - These indicate the LLM tried to do something it shouldn't

3. **Increase timeout if needed**
   - Default is 30 seconds
   - Large requests might need more time

## Testing

To test the LLM integration:

1. Start LM Studio with a model loaded
2. Record or use an existing meeting audio with multiple speakers
3. Run diarization (either batch or during recording)
4. Watch the console logs for LLM activity
5. Verify the results include LLM enhancements

## Performance Impact

- **Typical LLM processing time**: 1-5 seconds
- **Additional latency**: Minimal (non-blocking)
- **Token usage per meeting**: 500-2000 tokens depending on meeting length
- **Network**: Local only (no external API calls)

## Future Enhancements

Potential improvements:
- [ ] UI to view LLM suggestions and apply/reject them
- [ ] Visual indicators showing which speakers were post-processed
- [ ] Confidence scores displayed in the UI
- [ ] Export LLM processing results for review
- [ ] Allow users to provide feedback to improve future processing
