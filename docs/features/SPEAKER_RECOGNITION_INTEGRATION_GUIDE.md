# Speaker Recognition Integration Guide

This guide shows how to integrate the persistent speaker recognition system with your existing transcription pipeline.

## Quick Start

### 1. Initialize the Service

```typescript
import { getSpeakerRecognitionIntegrationService } from './services/speakerRecognitionIntegrationService'

const speakerRecognition = getSpeakerRecognitionIntegrationService()

// Start a session when recording begins
speakerRecognition.startSession(meetingId)
```

### 2. Process Embedding Events from Python

```typescript
// Listen for embedding events in your Python stdout handler
pythonProcess.stdout.on('data', async (data) => {
  const lines = data.toString().split('\n')

  for (const line of lines) {
    if (!line.trim()) continue

    try {
      const event = JSON.parse(line)

      // Handle embedding events
      if (event.type === 'speaker_embedding') {
        const result = await speakerRecognition.processEmbeddingEvent(event)

        if (result.success) {
          console.log(`Speaker matched: ${result.persistentSpeakerId}`)
          console.log(`Is new speaker: ${result.isNewSpeaker}`)
          console.log(`Confidence: ${result.matchResult?.confidence_level}`)

          // Update any pending transcripts with this speaker ID
          // (More on this below)
        }
      }

      // Handle regular transcript segments
      if (event.type === 'segment') {
        // Store transcript with persistent speaker ID
        await handleTranscriptSegment(event)
      }
    } catch (error) {
      console.error('Failed to process event:', error)
    }
  }
})
```

### 3. Update Transcripts with Persistent Speaker IDs

There are two approaches to updating transcript segments with persistent speaker IDs:

#### Approach A: Update After Embedding Match (Immediate)

```typescript
// Keep a map of Python speaker IDs to pending transcript IDs
const pendingTranscripts = new Map<string, string[]>() // pythonSpeakerId -> transcriptIds

// When you receive a transcript segment
if (event.type === 'segment' && event.speaker) {
  // Store transcript
  const transcriptId = await storeTranscript(event)

  // Add to pending list
  if (!pendingTranscripts.has(event.speaker)) {
    pendingTranscripts.set(event.speaker, [])
  }
  pendingTranscripts.get(event.speaker)!.push(transcriptId)
}

// When you receive an embedding
if (event.type === 'speaker_embedding' && event.speaker) {
  const result = await speakerRecognition.processEmbeddingEvent(event)

  if (result.success) {
    // Update all pending transcripts for this speaker
    const pending = pendingTranscripts.get(event.speaker) || []

    for (const transcriptId of pending) {
      await speakerRecognition.updateTranscriptSpeaker({
        transcriptId,
        persistentSpeakerId: result.persistentSpeakerId!
      })
    }

    // Clear pending list
    pendingTranscripts.delete(event.speaker)
  }
}
```

#### Approach B: Batch Update at End (Simpler)

```typescript
// Store transcripts with Python speaker IDs during recording
if (event.type === 'segment') {
  await storeTranscript({
    ...event,
    // Store Python speaker ID temporarily in a custom field
    temp_speaker_id: event.speaker
  })
}

// At the end of recording, batch update all transcripts
async function finalizeRecording(meetingId: string) {
  // Get all Python -> persistent speaker mappings
  const mappings = speakerRecognition.getCurrentMeetingSpeakerMappings()

  // Get all transcripts for this meeting
  const transcripts = db.prepare(`
    SELECT id, temp_speaker_id
    FROM transcripts
    WHERE meeting_id = ?
  `).all(meetingId)

  // Build update list
  const updates = transcripts.map(t => ({
    transcriptId: t.id,
    pythonSpeakerId: t.temp_speaker_id
  }))

  // Batch update
  const result = await speakerRecognition.batchUpdateTranscriptSpeakers(updates)

  console.log(`Updated ${result.succeeded} transcripts, ${result.failed} failed`)

  // End the session
  speakerRecognition.endSession()
}
```

## Complete Example: Integrating with LiveTranscriptionService

Here's a complete example of integrating with the existing `liveTranscriptionService.ts`:

```typescript
// electron/services/liveTranscriptionService.ts

import { getSpeakerRecognitionIntegrationService } from './speakerRecognitionIntegrationService'

export class LiveTranscriptionService {
  private speakerRecognition = getSpeakerRecognitionIntegrationService()
  private pendingTranscripts = new Map<string, string[]>()

  async startRecording(meetingId: string) {
    // Initialize speaker recognition session
    this.speakerRecognition.startSession(meetingId)
    this.pendingTranscripts.clear()

    // Start Python diarization with embedding output enabled
    this.startPythonDiarization({
      outputEmbeddings: true  // Enable embedding output
    })

    // ... rest of recording setup
  }

  private setupPythonOutputHandlers(pythonProcess: ChildProcess, meetingId: string) {
    pythonProcess.stdout?.on('data', async (data) => {
      const lines = data.toString().split('\n')

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const event = JSON.parse(line)

          switch (event.type) {
            case 'speaker_embedding':
              await this.handleEmbedding(event)
              break

            case 'segment':
              await this.handleTranscriptSegment(event, meetingId)
              break

            case 'speaker_segment':
              // Speaker timing information (keep existing logic)
              break

            // ... other event types
          }
        } catch (error) {
          console.error('Error processing Python output:', error)
        }
      }
    })
  }

  private async handleEmbedding(event: any) {
    const result = await this.speakerRecognition.processEmbeddingEvent(event)

    if (result.success && event.speaker) {
      // Update all pending transcripts for this Python speaker ID
      const pending = this.pendingTranscripts.get(event.speaker) || []

      for (const transcriptId of pending) {
        await this.speakerRecognition.updateTranscriptSpeaker({
          transcriptId,
          persistentSpeakerId: result.persistentSpeakerId!
        })
      }

      this.pendingTranscripts.delete(event.speaker)

      // Log matching decision
      console.log(
        `[Speaker Recognition] ${event.speaker} -> ${result.persistentSpeakerId} ` +
        `(${result.isNewSpeaker ? 'NEW' : 'EXISTING'}, ` +
        `confidence: ${result.matchResult?.confidence_level})`
      )
    }
  }

  private async handleTranscriptSegment(event: any, meetingId: string) {
    // Store transcript in database
    const transcriptId = await this.storeTranscript({
      meeting_id: meetingId,
      content: event.text,
      start_time_ms: Math.round(event.start * 1000),
      end_time_ms: Math.round(event.end * 1000),
      confidence: event.confidence,
      // Don't set speaker_id yet - will be set when embedding is matched
    })

    // Add to pending list for this Python speaker
    if (event.speaker) {
      if (!this.pendingTranscripts.has(event.speaker)) {
        this.pendingTranscripts.set(event.speaker, [])
      }
      this.pendingTranscripts.get(event.speaker)!.push(transcriptId)
    }

    // Emit to UI
    this.emitTranscriptUpdate(event)
  }

  async stopRecording() {
    // Get session statistics
    const stats = this.speakerRecognition.getSessionStats()
    console.log('[Speaker Recognition] Session stats:', stats)

    // End the speaker recognition session
    this.speakerRecognition.endSession()

    // ... rest of stop recording logic
  }
}
```

## Testing the Integration

### 1. Test Embedding Output

Run Python diarization directly to verify embedding output:

```bash
cd python
python live_diarize.py --sample-rate 16000 --output-embeddings < test_audio.raw
```

You should see JSON output like:

```json
{"type":"speaker_embedding","embedding":[0.123,0.456,...],"dimension":192,"start":0.0,"end":2.0,"speaker":"Speaker_0","confidence":0.95,"extraction_model":"pyannote/embedding"}
```

### 2. Test Database Storage

```typescript
// Test script
import { getSpeakerEmbeddingService } from './services/speakerEmbeddingService'

const service = getSpeakerEmbeddingService()

// Create test embedding
const testEmbedding = new Float32Array(192).map(() => Math.random())

// Match speaker
const result = await service.matchSpeaker({
  embedding: testEmbedding,
  meeting_id: 'test-meeting',
  audio_segment_start_ms: 0,
  audio_segment_end_ms: 2000,
  extraction_model: 'pyannote/embedding'
})

console.log('Match result:', result)
// Expected: { is_new_speaker: true, ... } for first embedding
```

### 3. Test Speaker Matching

```typescript
// Store first embedding
await service.storeEmbedding({
  speaker_id: 'speaker-1',
  meeting_id: 'test-meeting',
  embedding: testEmbedding,
  extraction_model: 'pyannote/embedding'
})

// Try matching a similar embedding
const similarEmbedding = testEmbedding.map(v => v + Math.random() * 0.1)

const result2 = await service.matchSpeaker({
  embedding: new Float32Array(similarEmbedding),
  meeting_id: 'test-meeting',
  audio_segment_start_ms: 2000,
  audio_segment_end_ms: 4000,
  extraction_model: 'pyannote/embedding'
})

console.log('Match result 2:', result2)
// Expected: { is_new_speaker: false, speaker_id: 'speaker-1', similarity_score: >0.9 }
```

## Monitoring & Debugging

### View Speaker Profiles

```typescript
const profiles = service.getAllSpeakerProfiles()

profiles.forEach(profile => {
  console.log(`Speaker: ${profile.speaker_id}`)
  console.log(`  Embeddings: ${profile.embedding_count}`)
  console.log(`  Quality: ${profile.profile_quality}`)
  console.log(`  Variance: ${profile.embedding_variance}`)
})
```

### View Matching Log

```typescript
const matchingLog = service.getMatchingLogForMeeting(meetingId)

matchingLog.forEach(log => {
  console.log(`${log.audio_segment_start_ms}ms: ${log.matched_speaker_id} ` +
              `(similarity: ${log.similarity_score}, confidence: ${log.confidence_level})`)
})
```

### Session Statistics

```typescript
const stats = speakerRecognition.getSessionStats()

console.log(`Embeddings processed: ${stats.embeddingsProcessed}`)
console.log(`New speakers created: ${stats.newSpeakersCreated}`)
console.log(`Existing speakers matched: ${stats.existingSpeakersMatched}`)
console.log(`Errors: ${stats.errors}`)
```

## Performance Tips

### 1. Batch Database Operations

Use transactions for batch operations:

```typescript
const updateTransaction = db.transaction(() => {
  for (const update of updates) {
    speakerRecognition.updateTranscriptSpeaker(update)
  }
})

updateTransaction()
```

### 2. Limit Embedding History

Periodically prune old embeddings:

```typescript
// Keep only last 50 embeddings per speaker
await service.pruneOldEmbeddings(speakerId, 50)
```

### 3. Cache Speaker Profiles

The embedding service caches centroids in memory for fast matching. No additional caching needed.

## Troubleshooting

### Issue: No embeddings being output

**Check:**
1. Python flag: `--output-embeddings` is enabled (default)
2. Python logs: `output_embeddings: True` in ready event
3. Embedding extraction: Model loaded successfully

### Issue: All speakers marked as new

**Check:**
1. Session started: `startSession(meetingId)` called
2. Embeddings stored: Check `speaker_embeddings` table
3. Similarity threshold: May be too strict (default 0.85 for high confidence)

### Issue: Wrong speaker assignments

**Check:**
1. Embedding quality: Check `confidence_score` in database
2. Audio quality: Low quality audio produces poor embeddings
3. Model consistency: Using same extraction model throughout
4. Threshold tuning: May need to adjust similarity thresholds

## Next Steps

- Add UI for viewing speaker profiles
- Implement manual speaker merge/split
- Add speaker name suggestions from transcript analysis
- Enable cross-device speaker profile sync
