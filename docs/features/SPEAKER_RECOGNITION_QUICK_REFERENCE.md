# Speaker Recognition Quick Reference

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Embedding** | 192-512 dimensional vector representing voice characteristics |
| **Centroid** | Average embedding representing a speaker's voice profile |
| **Cosine Similarity** | Measure of similarity (0-1), higher = more similar |
| **Profile Quality** | `learning` (0-4), `stable` (5-9), `verified` (10+) embeddings |

## Similarity Thresholds

```typescript
HIGH_CONFIDENCE    = 0.85  // Definitely same speaker
MEDIUM_CONFIDENCE  = 0.70  // Probably same speaker
NEW_SPEAKER        = 0.50  // Probably different speaker
```

## API Quick Reference

### Start/Stop Session

```typescript
import { getSpeakerRecognitionIntegrationService } from './services/speakerRecognitionIntegrationService'

const service = getSpeakerRecognitionIntegrationService()

// Start
service.startSession(meetingId)

// End
service.endSession()
```

### Process Embedding

```typescript
const result = await service.processEmbeddingEvent({
  type: 'speaker_embedding',
  embedding: [0.123, 0.456, ...],
  dimension: 192,
  start: 0.0,
  end: 2.0,
  speaker: 'Speaker_0',
  confidence: 0.95,
  extraction_model: 'pyannote/embedding'
})

// Result:
// {
//   success: true,
//   persistentSpeakerId: 'uuid-123',
//   isNewSpeaker: false,
//   matchResult: { ... }
// }
```

### Update Transcripts

```typescript
// Single update
await service.updateTranscriptSpeaker({
  transcriptId: 'transcript-123',
  pythonSpeakerId: 'Speaker_0'  // or persistentSpeakerId directly
})

// Batch update
const result = await service.batchUpdateTranscriptSpeakers([
  { transcriptId: 'transcript-1', pythonSpeakerId: 'Speaker_0' },
  { transcriptId: 'transcript-2', pythonSpeakerId: 'Speaker_1' }
])
```

### Get Speaker Info

```typescript
// Get persistent ID from Python ID
const persistentId = service.getPersistentSpeakerId('Speaker_0')

// Get all mappings
const mappings = service.getCurrentMeetingSpeakerMappings()

// Get profiles
const profiles = service.getMeetingSpeakerProfiles()
```

## Database Tables

### speaker_embeddings

```sql
SELECT * FROM speaker_embeddings WHERE speaker_id = ?
```

| Field | Type | Description |
|-------|------|-------------|
| id | TEXT | UUID |
| speaker_id | TEXT | Links to speakers table |
| embedding_vector | BLOB | Serialized Float32Array |
| embedding_dimension | INTEGER | 192 or 512 |
| extraction_model | TEXT | Model used |
| confidence_score | REAL | Quality (0-1) |

### speaker_profiles

```sql
SELECT * FROM speaker_profiles WHERE speaker_id = ?
```

| Field | Type | Description |
|-------|------|-------------|
| speaker_id | TEXT | Links to speakers table |
| embedding_count | INTEGER | Number of embeddings |
| centroid_embedding | BLOB | Average embedding |
| profile_quality | TEXT | learning/stable/verified |
| embedding_variance | REAL | Voice consistency measure |

### speaker_matching_log

```sql
SELECT * FROM speaker_matching_log WHERE meeting_id = ? ORDER BY audio_segment_start_ms
```

| Field | Type | Description |
|-------|------|-------------|
| meeting_id | TEXT | Meeting reference |
| matched_speaker_id | TEXT | Matched speaker |
| similarity_score | REAL | Similarity (0-1) |
| is_new_speaker | BOOLEAN | New or existing |
| confidence_level | TEXT | low/medium/high/verified |

## Python Command Line

```bash
# With embeddings (default)
python live_diarize.py --sample-rate 16000 --output-embeddings

# Without embeddings
python live_diarize.py --sample-rate 16000 --no-output-embeddings

# Full options
python live_diarize.py \
  --sample-rate 16000 \
  --similarity-threshold 0.35 \
  --max-speakers 10 \
  --output-embeddings \
  --device cuda
```

## Event Types from Python

### speaker_embedding

```json
{
  "type": "speaker_embedding",
  "embedding": [0.123, 0.456, ...],
  "dimension": 192,
  "start": 0.0,
  "end": 2.0,
  "speaker": "Speaker_0",
  "confidence": 0.95,
  "extraction_model": "pyannote/embedding"
}
```

### speaker_segment

```json
{
  "type": "speaker_segment",
  "speaker": "Speaker_0",
  "start": 0.0,
  "end": 2.0,
  "confidence": 0.92
}
```

## Common Patterns

### Pattern 1: Immediate Update

```typescript
// Store transcripts with temp IDs
const pendingTranscripts = new Map<string, string[]>()

// On transcript
if (event.type === 'segment') {
  const id = await storeTranscript(event)
  pendingTranscripts.get(event.speaker)?.push(id) ||
    pendingTranscripts.set(event.speaker, [id])
}

// On embedding
if (event.type === 'speaker_embedding') {
  const result = await service.processEmbeddingEvent(event)

  for (const transcriptId of pendingTranscripts.get(event.speaker) || []) {
    await service.updateTranscriptSpeaker({
      transcriptId,
      persistentSpeakerId: result.persistentSpeakerId!
    })
  }
}
```

### Pattern 2: Batch Update

```typescript
// Store with Python IDs during recording
// Update all at end
async function finalize() {
  const transcripts = getAllTranscripts(meetingId)
  const updates = transcripts.map(t => ({
    transcriptId: t.id,
    pythonSpeakerId: t.temp_speaker_id
  }))

  await service.batchUpdateTranscriptSpeakers(updates)
  service.endSession()
}
```

## Debugging

### Enable Debug Logging

```typescript
// Check session stats
console.log(service.getSessionStats())

// View speaker profiles
const profiles = service.getMeetingSpeakerProfiles()
console.table(profiles)

// View matching decisions
const embeddingService = getSpeakerEmbeddingService()
const log = embeddingService.getMatchingLogForMeeting(meetingId)
console.table(log)
```

### Common Issues

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| All new speakers | Session not started | Call `startSession()` |
| No embeddings | Python flag disabled | Enable `--output-embeddings` |
| Wrong matches | Threshold too low | Increase similarity threshold |
| Too many speakers | Threshold too high | Decrease similarity threshold |

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Match embedding | <1ms | With 10 speakers |
| Store embedding | <5ms | Including profile update |
| Batch update | ~1ms per transcript | Use transactions |
| Profile calculation | <10ms | Automatic on store |

## Testing

```typescript
// Create test embedding
const testEmbed = new Float32Array(192).fill(0.1)

// Test matching
const result = await embeddingService.matchSpeaker({
  embedding: testEmbed,
  meeting_id: 'test',
  audio_segment_start_ms: 0,
  audio_segment_end_ms: 2000,
  extraction_model: 'pyannote/embedding'
})

// Should be new speaker on first call
assert(result.is_new_speaker === true)

// Store it
await embeddingService.storeEmbedding({
  speaker_id: 'speaker-1',
  meeting_id: 'test',
  embedding: testEmbed,
  extraction_model: 'pyannote/embedding'
})

// Match again - should match
const result2 = await embeddingService.matchSpeaker({ ... })
assert(result2.is_new_speaker === false)
assert(result2.speaker_id === 'speaker-1')
assert(result2.similarity_score > 0.95)
```

## Migration

Database migration runs automatically on app start (version 18).

To manually apply:

```typescript
import { getDatabaseService } from './services/database'
const db = getDatabaseService()
// Migrations run automatically
```

## Files Changed/Created

```
✅ electron/services/database.ts             (migration #18)
✅ electron/services/speakerEmbeddingService.ts
✅ electron/services/speakerRecognitionIntegrationService.ts
✅ python/live_diarize.py                    (embedding output)
📝 docs/features/PERSISTENT_SPEAKER_RECOGNITION.md
📝 docs/features/SPEAKER_RECOGNITION_INTEGRATION_GUIDE.md
```

## Next Steps

1. Integrate with `liveTranscriptionService.ts`
2. Add UI for speaker profile management
3. Test with real meetings
4. Fine-tune similarity thresholds
5. Add manual speaker merge/split tools
