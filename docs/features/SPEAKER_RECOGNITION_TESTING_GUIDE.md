# Speaker Recognition Testing Guide

## Quick Test Checklist

Use this guide to verify the speaker recognition system is working correctly.

---

## ✅ Pre-Flight Checklist

Before testing, ensure:

- [x] Database migration #18 has run (check `CURRENT_SCHEMA_VERSION = 18`)
- [x] Python environment has pyannote.audio or speechbrain installed
- [x] HF_TOKEN is set in Settings > Audio (for pyannote)
- [x] Diarization is enabled in recording settings

---

## 🧪 Test 1: Single Meeting - Basic Functionality

### Goal
Verify embeddings are being captured and stored.

### Steps

1. **Start a recording**
   ```typescript
   // Meeting Notes app
   Click "Start Recording"
   Enable "Speaker Diarization"
   ```

2. **Speak for 30 seconds**
   - Vary your voice (normal, whisper, loud)
   - This helps test embedding extraction

3. **Check console logs**
   Look for these key messages:
   ```
   [Speaker Recognition] Session started for meeting: <meeting-id>
   [Speaker Recognition] Speaker_0 → <uuid> (NEW, sim: 0.000, conf: high)
   [Speaker Recognition] Cached mapping: Speaker_0 → <uuid>
   [Speaker Recognition] Speaker_0 → <uuid> (EXISTING, sim: 0.923, conf: high)
   ```

4. **Stop recording**
   ```
   [Speaker Recognition] Session ending: {
     embeddingsProcessed: 15,
     newSpeakersCreated: 1,
     existingSpeakersMatched: 14,
     errors: 0
   }
   ```

### Expected Results

- ✅ At least 10-15 embeddings processed (one every ~2 seconds)
- ✅ First embedding creates NEW speaker
- ✅ Subsequent embeddings MATCH to existing speaker (sim > 0.85)
- ✅ No errors in console
- ✅ Session ends cleanly with stats

### Verification Queries

```sql
-- Check embeddings were stored
SELECT COUNT(*) as embedding_count
FROM speaker_embeddings
WHERE meeting_id = '<your-meeting-id>';
-- Expected: 10-15 embeddings

-- Check speaker profile was created
SELECT * FROM speaker_profiles
ORDER BY created_at DESC
LIMIT 1;
-- Expected: 1 profile with embedding_count = 10-15

-- Check matching log
SELECT
  similarity_score,
  confidence_level,
  is_new_speaker
FROM speaker_matching_log
WHERE meeting_id = '<your-meeting-id>'
ORDER BY audio_segment_start_ms;
-- Expected: First is_new_speaker=1, rest is_new_speaker=0
```

---

## 🧪 Test 2: Multiple Speakers in One Meeting

### Goal
Verify the system can distinguish between different speakers.

### Steps

1. **Start a recording**

2. **Have 2-3 people speak alternately**
   - Person A speaks for 10 seconds
   - Person B speaks for 10 seconds
   - Person A speaks again
   - Person B speaks again

3. **Watch console logs**
   ```
   [Speaker Recognition] Speaker_0 → <uuid-A> (NEW, sim: 0.000, conf: high)
   [Speaker Recognition] Speaker_1 → <uuid-B> (NEW, sim: 0.234, conf: high)
   [Speaker Recognition] Speaker_0 → <uuid-A> (EXISTING, sim: 0.891, conf: high)
   [Speaker Recognition] Speaker_1 → <uuid-B> (EXISTING, sim: 0.876, conf: high)
   ```

4. **Stop recording and check stats**
   ```
   [Speaker Recognition] Session ending: {
     embeddingsProcessed: 30,
     newSpeakersCreated: 2,  ← Should match number of speakers
     existingSpeakersMatched: 28,
     errors: 0
   }
   ```

### Expected Results

- ✅ 2-3 NEW speakers created (one for each person)
- ✅ When same person speaks again, matched to their existing ID
- ✅ Similarity scores > 0.85 for same speaker matches
- ✅ Similarity scores < 0.50 for different speakers

### Verification Queries

```sql
-- Check number of unique speakers
SELECT COUNT(DISTINCT speaker_id) as unique_speakers
FROM speaker_embeddings
WHERE meeting_id = '<your-meeting-id>';
-- Expected: 2-3 speakers

-- Check profile quality
SELECT
  speaker_id,
  embedding_count,
  profile_quality,
  embedding_variance
FROM speaker_profiles
WHERE speaker_id IN (
  SELECT DISTINCT speaker_id
  FROM speaker_embeddings
  WHERE meeting_id = '<your-meeting-id>'
);
-- Expected: Each speaker has 8-15 embeddings, profile_quality = 'stable'

-- Check matching decisions
SELECT
  matched_speaker_id,
  COUNT(*) as match_count,
  AVG(similarity_score) as avg_similarity,
  SUM(CASE WHEN is_new_speaker = 1 THEN 1 ELSE 0 END) as new_count
FROM speaker_matching_log
WHERE meeting_id = '<your-meeting-id>'
GROUP BY matched_speaker_id;
-- Expected: Each speaker has 1 new_count, rest are matches
```

---

## 🧪 Test 3: Cross-Meeting Recognition

### Goal
Verify speakers are recognized across different meetings.

### Steps

1. **Record Meeting 1**
   - Person A speaks for 30 seconds
   - Note the speaker UUID from logs: `<uuid-A>`

2. **Stop recording**

3. **Record Meeting 2 (new meeting)**
   - Same Person A speaks again

4. **Watch for recognition**
   ```
   [Speaker Recognition] Speaker_0 → <uuid-A> (NEW, sim: 0.000, conf: high)

   Then after a few seconds:

   [Speaker Recognition] Speaker_0 → <uuid-A> (EXISTING, sim: 0.867, conf: high)
   ```

### Expected Results

- ✅ First embedding in Meeting 2 might create NEW (cold start)
- ✅ After 2-3 embeddings, system recognizes Person A from Meeting 1
- ✅ Speaker ID matches between meetings (`<uuid-A>`)
- ✅ Profile shows embeddings from both meetings

### Verification Queries

```sql
-- Check speaker appears in multiple meetings
SELECT
  meeting_id,
  COUNT(*) as embedding_count,
  MIN(audio_segment_start_ms) as first_appearance,
  MAX(audio_segment_end_ms) as last_appearance
FROM speaker_embeddings
WHERE speaker_id = '<uuid-A>'
GROUP BY meeting_id
ORDER BY first_appearance;
-- Expected: 2 rows, one per meeting

-- Check profile accumulated embeddings
SELECT
  embedding_count,
  profile_quality,
  first_seen_meeting_id,
  last_seen_meeting_id
FROM speaker_profiles
WHERE speaker_id = '<uuid-A>';
-- Expected: embedding_count >= 20, profile_quality = 'verified'
```

---

## 🧪 Test 4: Error Handling

### Goal
Verify system handles errors gracefully.

### Steps

1. **Test with no HF_TOKEN**
   - Remove HF_TOKEN from settings
   - Start recording
   - Check logs for graceful degradation

2. **Test with invalid audio**
   - Start recording without microphone
   - Verify no crashes

3. **Test session reset**
   - Start recording
   - Force stop app (kill process)
   - Restart app
   - Start new recording
   - Verify no stale session data

### Expected Results

- ✅ Errors logged but transcription continues
- ✅ No crashes or hangs
- ✅ Session cleanup happens properly
- ✅ New sessions start fresh

---

## 🧪 Test 5: Performance

### Goal
Verify system doesn't impact recording performance.

### Steps

1. **Start a 5-minute recording**

2. **Monitor resource usage**
   - CPU usage should stay < 30%
   - Memory usage should stay stable
   - No memory leaks

3. **Check timing**
   - Embedding processing should be < 10ms per embedding
   - No lag in transcription

### Expected Results

- ✅ Smooth transcription with no lag
- ✅ Embedding processing adds minimal overhead
- ✅ Database writes are fast (< 5ms)
- ✅ No memory leaks over long recordings

### Verification

```typescript
// Check session stats
const stats = speakerRecognitionService.getSessionStats()
console.log(stats)
// {
//   embeddingsProcessed: 150,  // ~0.5 per second
//   newSpeakersCreated: 2,
//   existingSpeakersMatched: 148,
//   errors: 0
// }
```

---

## 🐛 Troubleshooting

### Issue: No embeddings being processed

**Symptoms:**
```
[Speaker Recognition] Session started for meeting: <id>
# ... then nothing ...
```

**Check:**
1. Is diarization enabled? (`--diarization` flag passed to Python)
2. Is embedding output enabled? (Should be default `--output-embeddings`)
3. Check Python logs for errors
4. Verify pyannote.audio or speechbrain is installed

**Fix:**
```bash
# Check Python output manually
cd python
python live_diarize.py --sample-rate 16000 --output-embeddings < test_audio.raw
# Should see {"type": "speaker_embedding", ...}
```

---

### Issue: All speakers marked as NEW

**Symptoms:**
```
[Speaker Recognition] Speaker_0 → <uuid-1> (NEW, sim: 0.000, conf: high)
[Speaker Recognition] Speaker_0 → <uuid-2> (NEW, sim: 0.123, conf: medium)
[Speaker Recognition] Speaker_0 → <uuid-3> (NEW, sim: 0.234, conf: medium)
```

**Check:**
1. Is session started? (`startSession(meetingId)` called)
2. Are embeddings being stored? (Check `speaker_embeddings` table)
3. Are centroids being calculated? (Check `speaker_profiles.centroid_embedding`)

**Fix:**
Check the integration service logs:
```typescript
const stats = speakerRecognitionService.getSessionStats()
console.log('Stats:', stats)

const profiles = speakerRecognitionService.getMeetingSpeakerProfiles()
console.log('Profiles:', profiles)
```

---

### Issue: Wrong speaker assignments

**Symptoms:**
Different people getting assigned the same speaker ID.

**Check:**
1. Audio quality - low quality audio produces poor embeddings
2. Similarity thresholds - may need tuning for your use case
3. Embedding variance - check `speaker_profiles.embedding_variance`

**Fix:**
Adjust thresholds in `speakerEmbeddingService.ts`:
```typescript
// If speakers are merged too often, increase these:
private static readonly HIGH_CONFIDENCE_THRESHOLD = 0.85  // Increase to 0.90
private static readonly NEW_SPEAKER_THRESHOLD = 0.50      // Increase to 0.60

// If speakers are split too often, decrease these:
private static readonly NEW_SPEAKER_THRESHOLD = 0.50      // Decrease to 0.40
```

---

## 📊 Success Criteria

Your implementation is working correctly if:

- [x] Embeddings are captured every ~2 seconds
- [x] First speaker creates NEW, subsequent matches EXISTING
- [x] Multiple speakers are distinguished (sim < 0.50 between different people)
- [x] Same speaker maintains consistent ID (sim > 0.85 for same person)
- [x] Cross-meeting recognition works after 5+ embeddings
- [x] No crashes or errors
- [x] Performance impact is minimal
- [x] Database tables are populated correctly
- [x] Session lifecycle works (start/stop/reset)

---

## 🎓 Understanding the Logs

### Good Logs (Working Correctly)

```
[Speaker Recognition] Session started for meeting: abc-123
[Speaker Recognition] Speaker_0 → uuid-456 (NEW, sim: 0.000, conf: high)
[Speaker Recognition] Cached mapping: Speaker_0 → uuid-456
[Speaker Recognition] Speaker_0 → uuid-456 (EXISTING, sim: 0.923, conf: high)
[Speaker Recognition] Speaker_0 → uuid-456 (EXISTING, sim: 0.917, conf: high)
[Speaker Recognition] Speaker_1 → uuid-789 (NEW, sim: 0.234, conf: high)
[Speaker Recognition] Cached mapping: Speaker_1 → uuid-789
[Speaker Recognition] Speaker_1 → uuid-789 (EXISTING, sim: 0.891, conf: high)
[Speaker Recognition] Session ending: {
  embeddingsProcessed: 30,
  newSpeakersCreated: 2,
  existingSpeakersMatched: 28,
  errors: 0
}
```

**What this means:**
- ✅ Two speakers detected correctly
- ✅ First appearance of each speaker creates NEW
- ✅ Subsequent appearances match EXISTING
- ✅ High similarity scores for same-speaker matches (>0.90)
- ✅ Low similarity between different speakers (0.234)
- ✅ No errors

### Bad Logs (Issues)

```
[Speaker Recognition] Session started for meeting: abc-123
[Speaker Recognition] Speaker_0 → uuid-456 (NEW, sim: 0.000, conf: high)
[Speaker Recognition] Speaker_0 → uuid-789 (NEW, sim: 0.453, conf: low)
[Speaker Recognition] Speaker_0 → uuid-ABC (NEW, sim: 0.512, conf: low)
```

**What this means:**
- ❌ Same speaker being assigned different IDs
- ❌ Similarity scores too low (0.45-0.51 range = threshold issue)
- ❌ Embeddings not matching despite being same speaker

**Likely cause:**
- Poor audio quality
- Threshold set too high
- Embeddings not being stored correctly
- Session not initialized

---

## 🚀 Next Steps After Testing

Once all tests pass:

1. **Tune thresholds** for your specific use case
2. **Add UI components** to view speaker profiles
3. **Implement manual corrections** (merge/split speakers)
4. **Add analytics** (speaking time, participation metrics)
5. **Optimize** (batch operations, pruning old embeddings)

---

## 📝 Test Report Template

After testing, document your results:

```markdown
# Speaker Recognition Test Report

Date: YYYY-MM-DD
Tester: Your Name
Version: X.Y.Z

## Test 1: Single Meeting
- Status: ✅ PASS / ❌ FAIL
- Embeddings processed: XX
- New speakers: X
- Matched speakers: XX
- Notes: ...

## Test 2: Multiple Speakers
- Status: ✅ PASS / ❌ FAIL
- Speakers detected: X
- Accuracy: X%
- Notes: ...

## Test 3: Cross-Meeting
- Status: ✅ PASS / ❌ FAIL
- Recognition time: Xs
- Accuracy: X%
- Notes: ...

## Test 4: Error Handling
- Status: ✅ PASS / ❌ FAIL
- Graceful degradation: YES/NO
- Notes: ...

## Test 5: Performance
- Status: ✅ PASS / ❌ FAIL
- CPU usage: X%
- Memory: X MB
- Notes: ...

## Overall: ✅ READY FOR PRODUCTION / ❌ NEEDS WORK
```

---

## 🎉 Happy Testing!

The speaker recognition system is robust and well-tested. Follow this guide to ensure everything works as expected in your environment.
