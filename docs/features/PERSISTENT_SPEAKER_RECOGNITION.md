# Persistent Speaker Recognition with Voice Embeddings

## Overview

This feature implements persistent speaker recognition across audio chunks and meetings using voice embeddings stored in the database. This solves the problem where chunk-based diarization returns inconsistent speaker IDs (e.g., `speaker_0` in every chunk referring to different people).

## Problem Statement

### Current Issue
The existing diarization system processes audio in chunks and assigns speaker IDs independently within each chunk using cosine similarity. This causes:

1. **Inconsistent speaker IDs across chunks** - The same person gets different speaker IDs in different chunks
2. **Loss of speaker context** - No memory of speakers from previous chunks
3. **No cross-meeting recognition** - Cannot recognize returning speakers in different meetings
4. **speaker_0 problem** - Every chunk outputs `speaker_0` which might be different people

### Solution
Store speaker voice embeddings (fingerprints) in the database to create a **persistent voice memory** that:

1. Recognizes returning speakers across chunks
2. Assigns consistent speaker labels throughout a recording
3. Enables cross-meeting speaker recognition
4. Builds improving speaker profiles over time

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Audio Chunk (5s)                         │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  Python: Extract      │  ← pyannote/speechbrain
        │  Speaker Embeddings   │     (192-512 dimensional vectors)
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  Electron: Match      │  ← Compare with stored embeddings
        │  Against Database     │     using cosine similarity
        └───────────┬───────────┘
                    │
            ┌───────┴──────────┐
            │                  │
            ▼                  ▼
    ┌──────────────┐   ┌──────────────┐
    │ Known Speaker│   │  New Speaker │
    │ (sim > 0.85) │   │ (sim < 0.50) │
    └──────┬───────┘   └──────┬───────┘
           │                  │
           │                  ▼
           │          ┌──────────────┐
           │          │ Create New   │
           │          │ Speaker ID   │
           │          └──────┬───────┘
           │                 │
           └────────┬────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  Store Embedding +    │  ← Add to database
        │  Update Profile       │     Update centroid
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  Assign Consistent    │  ← Transcript segments get
        │  Speaker Label        │     stable speaker IDs
        └───────────────────────┘
```

### Database Schema

#### `speaker_embeddings` Table
Stores individual voice embedding vectors for each speaker segment.

```sql
CREATE TABLE speaker_embeddings (
  id TEXT PRIMARY KEY,
  speaker_id TEXT NOT NULL,              -- Links to speakers table
  meeting_id TEXT,                       -- Optional: where first detected
  embedding_vector BLOB NOT NULL,        -- Serialized Float32Array
  embedding_dimension INTEGER NOT NULL,  -- 192 for pyannote, 512 for speechbrain
  extraction_model TEXT NOT NULL,        -- "pyannote/embedding", etc.
  model_version TEXT,                    -- For compatibility tracking
  confidence_score REAL DEFAULT 1.0,     -- Quality of this embedding
  audio_segment_start_ms INTEGER,        -- Original audio timestamp
  audio_segment_end_ms INTEGER,
  audio_quality_score REAL,              -- Audio quality measure
  is_verified BOOLEAN DEFAULT 0,         -- User verified
  verification_method TEXT,               -- 'manual', 'automatic', 'high_confidence'
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE CASCADE,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
);
```

#### `speaker_profiles` Table
Aggregated statistics and centroid embeddings for fast matching.

```sql
CREATE TABLE speaker_profiles (
  id TEXT PRIMARY KEY,
  speaker_id TEXT NOT NULL UNIQUE,
  embedding_count INTEGER DEFAULT 0,     -- Number of embeddings collected
  average_confidence REAL DEFAULT 1.0,   -- Average quality
  centroid_embedding BLOB,               -- Average embedding (for fast matching)
  centroid_dimension INTEGER,
  extraction_model TEXT,
  first_seen_meeting_id TEXT,
  last_seen_meeting_id TEXT,
  first_seen_at TEXT,
  last_seen_at TEXT,
  total_speaking_duration_seconds INTEGER DEFAULT 0,
  total_segments INTEGER DEFAULT 0,
  profile_quality TEXT DEFAULT 'learning',  -- 'learning', 'stable', 'verified'
  embedding_variance REAL,               -- Measure of voice consistency
  notes TEXT,                            -- User notes
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE CASCADE
);
```

#### `speaker_matching_log` Table
Tracks all matching decisions for debugging and analysis.

```sql
CREATE TABLE speaker_matching_log (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  audio_segment_start_ms INTEGER NOT NULL,
  audio_segment_end_ms INTEGER NOT NULL,
  matched_speaker_id TEXT,
  similarity_score REAL,
  second_best_speaker_id TEXT,
  second_best_similarity REAL,
  matching_method TEXT NOT NULL,         -- 'centroid', 'ensemble', 'temporal', 'manual'
  is_new_speaker BOOLEAN DEFAULT 0,
  confidence_level TEXT DEFAULT 'medium', -- 'low', 'medium', 'high', 'verified'
  decision_factors TEXT,                 -- JSON: reasons for match decision
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
```

## Implementation Components

### 1. Python: Embedding Extraction

**File**: `python/live_diarize.py` (modifications needed)

```python
def extract_embedding_with_output(audio: np.ndarray, start_time: float, end_time: float):
    """Extract embedding and output it for storage in database"""
    embedding = embedding_extractor.extract_embedding(audio)

    # Output embedding as JSON for Electron to capture
    output_json({
        "type": "speaker_embedding",
        "start": start_time,
        "end": end_time,
        "embedding": embedding.tolist(),  # Convert numpy array to list
        "dimension": len(embedding),
        "model": "pyannote/embedding",
        "confidence": 0.95  # From extraction quality
    })

    return embedding
```

### 2. TypeScript: Embedding Storage Service

**File**: `electron/services/speakerEmbeddingService.ts` (created)

Key methods:
- `storeEmbedding()` - Save embedding to database
- `matchSpeaker()` - Find best matching speaker or create new
- `getSpeakerProfile()` - Get speaker profile with statistics
- `updateSpeakerProfile()` - Recalculate centroid and statistics

### 3. TypeScript: Integration with Transcription Pipeline

**File**: `electron/services/liveTranscriptionService.ts` (modifications needed)

```typescript
// Listen for embedding events from Python
pythonProcess.stdout.on('data', async (data) => {
  const lines = data.toString().split('\n')

  for (const line of lines) {
    if (!line.trim()) continue

    try {
      const event = JSON.parse(line)

      if (event.type === 'speaker_embedding') {
        // Convert embedding list to Float32Array
        const embedding = new Float32Array(event.embedding)

        // Match against database
        const matchResult = await speakerEmbeddingService.matchSpeaker({
          embedding,
          meeting_id: currentMeetingId,
          audio_segment_start_ms: event.start * 1000,
          audio_segment_end_ms: event.end * 1000,
          extraction_model: event.model
        })

        if (matchResult.is_new_speaker) {
          // Create new speaker in database
          const newSpeakerId = await createNewSpeaker()

          // Store the embedding
          await speakerEmbeddingService.storeEmbedding({
            speaker_id: newSpeakerId,
            meeting_id: currentMeetingId,
            embedding,
            extraction_model: event.model,
            confidence_score: event.confidence
          })
        } else {
          // Store embedding for existing speaker
          await speakerEmbeddingService.storeEmbedding({
            speaker_id: matchResult.speaker_id!,
            meeting_id: currentMeetingId,
            embedding,
            extraction_model: event.model,
            confidence_score: event.confidence
          })
        }
      }
    } catch (error) {
      console.error('Failed to process embedding:', error)
    }
  }
})
```

## Matching Algorithm

### Similarity Thresholds

```typescript
// High confidence - definitely the same speaker
HIGH_CONFIDENCE_THRESHOLD = 0.85

// Medium confidence - probably the same speaker
MEDIUM_CONFIDENCE_THRESHOLD = 0.70

// New speaker threshold - probably different speaker
NEW_SPEAKER_THRESHOLD = 0.50
```

### Matching Logic

```typescript
async matchSpeaker(embedding: Float32Array): Promise<SpeakerMatchResult> {
  // Get all speaker profiles
  const profiles = await getAllSpeakerProfiles()

  if (profiles.length === 0) {
    return { is_new_speaker: true, confidence_level: 'high' }
  }

  // Calculate similarity against all centroids
  const similarities = profiles.map(profile => ({
    speaker_id: profile.speaker_id,
    similarity: cosineSimilarity(embedding, profile.centroid_embedding)
  }))

  // Sort by similarity
  similarities.sort((a, b) => b.similarity - a.similarity)

  const best = similarities[0]

  // Apply thresholds
  if (best.similarity >= HIGH_CONFIDENCE_THRESHOLD) {
    return {
      speaker_id: best.speaker_id,
      is_new_speaker: false,
      confidence_level: 'high'
    }
  } else if (best.similarity >= MEDIUM_CONFIDENCE_THRESHOLD) {
    return {
      speaker_id: best.speaker_id,
      is_new_speaker: false,
      confidence_level: 'medium'
    }
  } else if (best.similarity >= NEW_SPEAKER_THRESHOLD) {
    // Uncertain - use profile quality to decide
    const profile = profiles.find(p => p.speaker_id === best.speaker_id)
    if (profile?.profile_quality === 'learning') {
      // Profile not stable yet, match anyway
      return {
        speaker_id: best.speaker_id,
        is_new_speaker: false,
        confidence_level: 'low'
      }
    } else {
      // Profile is stable, this is likely a new speaker
      return { is_new_speaker: true, confidence_level: 'medium' }
    }
  } else {
    // Very low similarity - definitely new speaker
    return { is_new_speaker: true, confidence_level: 'high' }
  }
}
```

## Profile Quality Levels

### Learning (0-4 embeddings)
- Profile is being built
- More permissive matching to allow profile growth
- Not yet reliable for high-confidence decisions

### Stable (5-9 embeddings)
- Profile has enough data for reliable matching
- Centroid represents speaker's voice well
- Sufficient for production use

### Verified (10+ embeddings)
- Highly reliable profile
- Multiple meetings and contexts captured
- Can confidently reject false matches

## Benefits

### 1. Consistent Speaker IDs
- Same person = same speaker ID throughout recording
- No more `speaker_0` ambiguity

### 2. Cross-Meeting Recognition
- Speakers recognized in future meetings
- "John" remains "John" across all meetings

### 3. Gradual Improvement
- Speaker profiles improve with each meeting
- More embeddings = better accuracy

### 4. Retrospective Correction
- Can manually merge incorrectly split speakers
- Can split incorrectly merged speakers
- Re-run matching with better profiles

### 5. Analytics & Insights
- Track speaker participation across meetings
- Identify frequent collaborators
- Speaking time statistics per speaker

## UI Components Needed

### 1. Speaker Profile Manager
- View all recognized speakers
- Edit speaker names
- View embedding count and profile quality
- Merge/split speakers manually

### 2. Meeting Speaker Review
- Review speaker assignments after recording
- Fix incorrect assignments
- View confidence levels for each segment

### 3. Speaker Statistics Dashboard
- Speaking time per speaker
- Meeting participation history
- Voice profile quality indicators

## Performance Considerations

### Embedding Storage
- Each embedding: ~768 bytes (192-dim float32)
- 100 embeddings per speaker: ~77 KB
- 10 speakers: ~770 KB
- **Impact**: Minimal storage overhead

### Matching Speed
- Cosine similarity: O(n) per speaker
- 10 speakers: ~10 comparisons
- With centroid pre-calculation: <1ms
- **Impact**: Negligible latency

### Memory Usage
- Load all centroids into memory
- 10 speakers × 192 dims × 4 bytes = ~7.7 KB
- **Impact**: Minimal RAM usage

## Testing Strategy

### Unit Tests
- Cosine similarity calculation
- Embedding serialization/deserialization
- Profile update logic
- Matching threshold logic

### Integration Tests
- Store and retrieve embeddings
- Profile creation and updates
- Cross-chunk speaker consistency
- Database transaction handling

### E2E Tests
- Record meeting with multiple speakers
- Verify consistent speaker IDs
- Check embedding storage
- Test cross-meeting recognition

## Rollout Plan

### Phase 1: Core Infrastructure (Week 1)
- ✅ Database migration
- ✅ Embedding service implementation
- Python embedding output modification
- Basic integration with transcription pipeline

### Phase 2: Matching & Storage (Week 2)
- Implement matching algorithm
- Profile update logic
- Testing with real audio
- Threshold tuning

### Phase 3: UI & Management (Week 3)
- Speaker profile viewer
- Manual merge/split tools
- Confidence indicators in UI
- Statistics dashboard

### Phase 4: Optimization & Polish (Week 4)
- Performance optimization
- Edge case handling
- Documentation
- User testing

## Migration Path for Existing Users

1. **Automatic profile building**: When users open old meetings, gradually build profiles from existing transcripts (if audio is available)
2. **Opt-in feature**: Initially optional, can be enabled in settings
3. **Fallback mode**: If embedding matching fails, fall back to chunk-based diarization
4. **Progressive enhancement**: Works alongside existing system, improves over time

## Future Enhancements

### 1. Multi-Model Ensemble
- Use both pyannote and speechbrain embeddings
- Combine similarities for better accuracy
- Fallback if one model unavailable

### 2. Temporal Context
- Consider speaker sequences (who spoke before/after)
- Conversation flow patterns
- Improved disambiguation

### 3. Audio Quality Weighting
- Weight high-quality embeddings more heavily
- Ignore low-quality segments
- Adaptive centroid calculation

### 4. Cross-Device Recognition
- Sync speaker profiles across devices
- Cloud-based speaker database (optional)
- Privacy-preserving profile sharing

## Success Metrics

1. **Speaker ID Consistency**: >95% same speaker keeps same ID across chunks
2. **New Speaker Detection**: >90% correctly identify when new speaker joins
3. **Cross-Meeting Recognition**: >85% recognize returning speakers in new meetings
4. **User Satisfaction**: Reduced manual corrections needed

## Related Documentation

- [Speaker Diarization Architecture](./SPEAKER_DIARIZATION.md)
- [Database Schema](../setup/DATABASE_SCHEMA.md)
- [Python Diarization Implementation](../../python/live_diarize.py)
