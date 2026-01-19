---
title: Speaker Diarization System
description: Comprehensive guide to FlowRecap's speaker diarization for identifying and segmenting speakers
tags:
  - features
  - diarization
  - speakers
  - audio
  - pyannote
lastUpdated: true
prev:
  text: 'Feature Summary'
  link: '/features/FEATURE_IMPLEMENTATION_SUMMARY'
next:
  text: 'Speaker Diarization Fix'
  link: '/features/SPEAKER_DIARIZATION_FIX'
---

# Speaker Diarization System

Comprehensive speaker diarization system for identifying and segmenting different speakers in audio recordings.

## Features

- **Voice Embedding Extraction**: Uses pyannote.audio or SpeechBrain (ECAPA-TDNN) for extracting speaker embeddings
- **Multiple Clustering Algorithms**:
  - Agglomerative clustering (hierarchical)
  - Spectral clustering (graph-based)
  - Online centroid-based (real-time)
  - Neural diarization (pyannote's full pipeline)
- **Speaker Change Detection**: Configurable boundary detection for both slow and rapid transitions
- **Overlapping Speech Handling**: Detects and labels segments where multiple speakers talk simultaneously
- **Audio Format Support**: WAV, MP3, M4A, FLAC, OGG, OPUS, AAC
- **Quality Metrics**: Confidence scoring, speaker clarity, boundary precision, overlap/silence ratios
- **Batch & Streaming**: Support for both complete files and real-time audio streams

## Installation

### Python Dependencies

```bash
# Navigate to python directory
cd python

# Install dependencies (use the appropriate venv)
./venv-3.12/bin/pip install -r requirements.txt

# OR if you have the venv activated:
pip install -r requirements.txt
```

### Required Packages

- **pyannote.audio** (optional but recommended): High-quality speaker embeddings and neural diarization
- **speechbrain** (optional): Alternative embedding backend
- **scikit-learn**: Clustering algorithms
- **torch & torchaudio**: Deep learning backend
- **soundfile / pydub**: Audio loading
- **numpy**: Numerical operations

### Hugging Face Access Token

For pyannote.audio models, you need a Hugging Face access token:

1. Create account at https://huggingface.co/
2. Request access to pyannote models:
   - https://huggingface.co/pyannote/speaker-diarization-3.1
   - https://huggingface.co/pyannote/embedding
3. Get your access token from https://huggingface.co/settings/tokens
4. Set environment variable:
   ```bash
   export HF_TOKEN="your_token_here"
   ```

## Usage

### Python CLI

```bash
# Basic diarization
python speaker_diarization.py audio.wav

# Specify number of speakers
python speaker_diarization.py audio.wav --num-speakers 3

# Use neural pipeline (best quality, requires HF_TOKEN)
python speaker_diarization.py audio.wav --neural-pipeline

# Full preprocessing with noise reduction
python speaker_diarization.py audio.wav --preprocess --noise-reduction

# Different output formats
python speaker_diarization.py audio.wav --format json --output result.json
python speaker_diarization.py audio.wav --format rttm --output result.rttm
python speaker_diarization.py audio.wav --format text
python speaker_diarization.py audio.wav --format srt --output result.srt

# Custom clustering and thresholds
python speaker_diarization.py audio.wav \
  --clustering spectral \
  --similarity-threshold 0.8 \
  --min-speakers 2 \
  --max-speakers 5
```

### TypeScript/Node.js API

```typescript
import { speakerDiarizationService } from './electron/services'

// Check if diarization is available
const availability = await speakerDiarizationService.isAvailable()
console.log('Diarization available:', availability.available)
console.log('Has neural pipeline:', availability.hasNeuralPipeline)

// Basic diarization
const result = await speakerDiarizationService.diarize('audio.wav')

console.log(`Detected ${result.numSpeakers} speakers`)
console.log(`${result.segments.length} segments`)

// With configuration
const result = await speakerDiarizationService.diarize('audio.wav', {
  numSpeakers: 3,               // Exact number (optional)
  minSpeakers: 2,               // Minimum speakers
  maxSpeakers: 5,               // Maximum speakers
  similarityThreshold: 0.75,    // Speaker matching threshold
  clusteringMethod: 'agglomerative', // Clustering algorithm
  device: 'auto',               // 'cuda', 'cpu', or 'auto'
  preprocess: true,             // Apply preprocessing
  noiseReduction: true,         // Apply noise reduction
  detectOverlaps: true,         // Detect overlapping speech
  useNeuralPipeline: false      // Use pyannote's full pipeline
})

// With progress updates
const result = await speakerDiarizationService.diarize(
  'audio.wav',
  { numSpeakers: 3 },
  (progress) => {
    console.log(`${progress.phase}: ${progress.progress.toFixed(0)}%`)
  }
)

// Access results
result.segments.forEach(segment => {
  console.log(
    `[${segment.start.toFixed(2)}s - ${segment.end.toFixed(2)}s] ` +
    `${segment.speaker} (${(segment.confidence * 100).toFixed(0)}%)`
  )
})

// Speaker statistics
Object.entries(result.speakerStats).forEach(([speaker, stats]) => {
  console.log(`${speaker}:`)
  console.log(`  Total time: ${stats.totalDuration.toFixed(1)}s`)
  console.log(`  Percentage: ${stats.percentage.toFixed(1)}%`)
  console.log(`  Segments: ${stats.segmentCount}`)
})

// Quality metrics
console.log('Quality Metrics:')
console.log(`  Overall confidence: ${(result.qualityMetrics.overallConfidence * 100).toFixed(0)}%`)
console.log(`  Speaker clarity: ${(result.qualityMetrics.speakerClarityScore * 100).toFixed(0)}%`)
console.log(`  Overlap ratio: ${(result.qualityMetrics.overlapRatio * 100).toFixed(1)}%`)
```

### Streaming Diarization

```typescript
// Start streaming session
await speakerDiarizationService.startStreamingSession({
  sampleRate: 16000,
  segmentDuration: 2.0,
  hopDuration: 0.5,
  similarityThreshold: 0.7,
  maxSpeakers: 10,
  device: 'auto'
})

// Listen for speaker segments
speakerDiarizationService.onStreamingSegment((segment) => {
  console.log(`${segment.speaker} speaking at ${segment.start}s`)
})

// Send audio chunks (16-bit PCM)
speakerDiarizationService.sendStreamingAudioChunk(audioBuffer)

// Stop session and get final results
const segments = await speakerDiarizationService.stopStreamingSession()
```

### Integrating with Transcription

```typescript
import {
  speakerDiarizationService,
  liveTranscriptionService
} from './electron/services'

// 1. Diarize the audio
const diarization = await speakerDiarizationService.diarize('audio.wav')

// 2. Transcribe the audio
const transcription = await transcribeAudio('audio.wav')

// 3. Assign speakers to transcription segments
const transcriptWithSpeakers = speakerDiarizationService.assignSpeakersToTranscripts(
  transcription.segments,
  diarization.segments
)

// Now each transcription segment has speaker info
transcriptWithSpeakers.forEach(segment => {
  console.log(`${segment.speaker}: ${segment.text}`)
})
```

## Output Formats

### JSON

```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 2.5,
      "speaker": "Speaker 1",
      "confidence": 0.92,
      "duration": 2.5
    },
    {
      "start": 2.5,
      "end": 5.0,
      "speaker": "Speaker 2",
      "confidence": 0.88,
      "duration": 2.5,
      "is_overlapping": true,
      "overlapping_speakers": ["Speaker 2", "Speaker 3"]
    }
  ],
  "speakers": ["Speaker 1", "Speaker 2", "Speaker 3"],
  "num_speakers": 3,
  "speaker_stats": {
    "Speaker 1": {
      "speaker_id": "Speaker 1",
      "total_duration": 45.2,
      "segment_count": 12,
      "average_segment_duration": 3.77,
      "percentage": 45.2,
      "first_appearance": 0.0,
      "last_appearance": 98.5
    }
  },
  "quality_metrics": {
    "overall_confidence": 0.89,
    "speaker_clarity_score": 0.91,
    "boundary_precision": 0.85,
    "overlap_ratio": 0.05,
    "silence_ratio": 0.12,
    "processing_time_seconds": 15.3,
    "segments_per_minute": 8.2
  },
  "audio_duration": 100.0
}
```

### RTTM (Rich Transcription Time Marked)

```
SPEAKER audio 1 0.000 2.500 <NA> <NA> Speaker_1 <NA> <NA>
SPEAKER audio 1 2.500 2.500 <NA> <NA> Speaker_2 <NA> <NA>
SPEAKER audio 1 5.000 3.000 <NA> <NA> Speaker_1 <NA> <NA>
```

### Text

```
[00:00.00 - 00:02.50] Speaker 1
[00:02.50 - 00:05.00] Speaker 2
[00:05.00 - 00:08.00] Speaker 1
```

### SRT

```
1
00:00:00,000 --> 00:00:02,500
[Speaker 1]

2
00:00:02,500 --> 00:00:05,000
[Speaker 2]
```

## Configuration Options

### Clustering Methods

- **`agglomerative`** (default): Hierarchical clustering with distance threshold
  - Best for: General purpose, good quality
  - Pros: Well-tested, configurable, handles variable speakers
  - Cons: Requires all embeddings in memory

- **`spectral`**: Graph-based clustering
  - Best for: Complex speaker patterns, better separation
  - Pros: Can handle non-linear speaker relationships
  - Cons: Slower, requires parameter tuning

- **`online`**: Online centroid-based clustering
  - Best for: Real-time/streaming diarization
  - Pros: Memory efficient, incremental updates
  - Cons: May be less accurate than offline methods

- **`neural`**: pyannote's full neural diarization pipeline
  - Best for: Highest quality (requires HF_TOKEN)
  - Pros: State-of-the-art accuracy
  - Cons: Slower, requires GPU for best performance

### Device Selection

- **`auto`** (default): Automatically select CUDA if available, otherwise CPU
- **`cuda`**: Use GPU acceleration (requires CUDA-enabled PyTorch)
- **`cpu`**: Use CPU only

### Similarity Threshold

Range: 0.0 - 1.0 (default: 0.7)

- **Higher (0.8-0.9)**: More conservative, may create more speakers
- **Lower (0.5-0.6)**: More aggressive merging, may combine similar speakers
- **Default (0.7)**: Balanced approach

## Performance Considerations

### Processing Time

The system targets **not exceeding 2x real-time** for batch processing:
- 1 minute audio → ~30-120 seconds processing time
- Factors: audio quality, number of speakers, clustering method, device

### Quality vs Speed Trade-offs

| Method | Speed | Quality | Use Case |
|--------|-------|---------|----------|
| Online clustering + CPU | Fast | Good | Real-time applications |
| Agglomerative + CPU | Medium | Very Good | Standard batch processing |
| Spectral + CPU | Slow | Very Good | High-quality offline |
| Neural pipeline + GPU | Medium | Excellent | Production with GPU |
| Neural pipeline + CPU | Slow | Excellent | Offline, no GPU available |

### Memory Usage

- **Batch processing**: Loads full audio into memory
- **Streaming**: Processes chunks, lower memory footprint
- **Embeddings**: ~512 floats per segment (2KB per 2s segment)

## Edge Cases & Limitations

### Handled Edge Cases

✅ **Single speaker audio**: Labels as "Speaker 1" throughout
✅ **Very short speaker turns**: Detects turns < 1 second
✅ **Background noise/music**: Preprocessing helps reduce interference
✅ **Variable speaker count**: Auto-detects 1-10+ speakers
✅ **Overlapping speech**: Detects and labels overlapping segments
✅ **Different audio formats**: Converts MP3, M4A, FLAC, etc. to WAV

### Known Limitations

⚠️ **Similar-sounding voices**: May cluster incorrectly (adjust similarity threshold)
⚠️ **Very noisy audio**: May degrade performance (use preprocessing & noise reduction)
⚠️ **Cross-talk**: Heavy overlapping speech reduces accuracy
⚠️ **Whispered speech**: May not detect speaker changes accurately
⚠️ **Very large speaker counts** (>10): May require manual tuning

## Troubleshooting

### "No module named 'pyannote.audio'"

```bash
# Install pyannote.audio
pip install pyannote.audio

# Set HF_TOKEN if using models
export HF_TOKEN="your_token_here"
```

### "No speaker embedding backend available"

Install at least one backend:
```bash
# Option 1: pyannote.audio (recommended)
pip install pyannote.audio

# Option 2: SpeechBrain (alternative)
pip install speechbrain
```

### "Speaker diarization script not found"

Ensure the Python script is at `python/speaker_diarization.py` relative to the project root.

### Poor diarization quality

1. **Try different clustering methods**: `--clustering spectral`
2. **Adjust similarity threshold**: `--similarity-threshold 0.8`
3. **Enable preprocessing**: `--preprocess --noise-reduction`
4. **Use neural pipeline** (if available): `--neural-pipeline`
5. **Specify speaker count**: `--num-speakers 3` (if known)

### Processing too slow

1. **Use faster clustering**: `--clustering online`
2. **Disable overlap detection**: `--no-overlap-detection`
3. **Skip preprocessing**: Remove `--preprocess` flag
4. **Use GPU**: `--device cuda` (requires CUDA PyTorch)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│           Speaker Diarization System                │
└─────────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
┌───────▼──────┐ ┌──────▼──────┐ ┌─────▼──────┐
│ Audio        │ │  Embedding  │ │ Clustering │
│ Preprocessing│ │  Extraction │ │ Algorithm  │
└──────────────┘ └─────────────┘ └────────────┘
        │               │               │
┌───────▼──────────────────────────────▼────────┐
│          Speaker Change Detection             │
└───────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────┐
│    Overlapping Speech Detection      │
└──────────────────────────────────────┘
        │
┌───────▼──────────────────────────────┐
│  Output Formatting & Quality Metrics │
└──────────────────────────────────────┘
```

## API Reference

See [speakerDiarizationService.ts](../electron/services/speakerDiarizationService.ts) for complete TypeScript API documentation.

Key methods:
- `diarize(audioPath, config?, onProgress?)` - Batch diarization
- `startStreamingSession(config?)` - Start real-time diarization
- `sendStreamingAudioChunk(audioData)` - Send audio to streaming session
- `stopStreamingSession()` - Stop and get final results
- `assignSpeakersToTranscripts(transcripts, diarization)` - Merge with transcription
- `isAvailable()` - Check if diarization dependencies are installed

## Testing

```bash
# Run all diarization tests
npm test tests/speaker-diarization.spec.ts

# Run with Playwright UI
npx playwright test tests/speaker-diarization.spec.ts --ui
```

## References

- [pyannote.audio documentation](https://github.com/pyannote/pyannote-audio)
- [SpeechBrain speaker recognition](https://speechbrain.readthedocs.io/en/latest/API/speechbrain.inference.speaker.html)
- [RTTM format specification](https://github.com/nryant/dscore#rttm)

## License

See main project LICENSE file.
