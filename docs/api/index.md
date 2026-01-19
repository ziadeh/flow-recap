---
title: API Reference
description: API reference documentation for FlowRecap's interfaces and services
tags:
  - api
  - reference
  - interfaces
  - services
  - documentation
lastUpdated: true
prev:
  text: 'Follow-Up Summary'
  link: '/troubleshooting/FOLLOW_UP_SUMMARY'
---

# API Reference

::: warning Work in Progress
This section is currently under development. API documentation will be added as the project matures.
:::

## Overview

FlowRecap's API is organized into several main areas:

### Electron IPC API

The application uses Electron's IPC (Inter-Process Communication) for communication between the renderer and main processes.

```typescript
// Example: Database API
window.electronAPI.db.meetings.getAll()
window.electronAPI.db.meetings.getById(id)
window.electronAPI.db.meetings.create(meeting)
window.electronAPI.db.meetings.update(id, data)
window.electronAPI.db.meetings.delete(id)
```

### Python Backend API

The transcription and diarization services are provided by a Python backend.

#### Transcription Commands

| Command | Description |
|---------|-------------|
| `transcribe` | Transcribe an audio file |
| `diarize` | Run speaker diarization |
| `validate` | Validate Python environment |
| `health` | Check service health |

### Database Schema

FlowRecap uses SQLite with the following main tables:

- `meetings` - Meeting records with metadata
- `transcript_segments` - Individual transcript segments
- `notes` - User notes and AI-generated insights
- `tasks` - Tasks linked to meetings
- `speaker_profiles` - Speaker identification data

## Planned Documentation

- [ ] Complete IPC API reference
- [ ] Database schema documentation
- [ ] Python service API
- [ ] React component API
- [ ] Zustand store documentation
- [ ] TypeScript interfaces

## Related Documentation

- [Implementation Notes](/development/IMPLEMENTATION_NOTES) - Technical implementation details
- [Console Output Guide](/development/CONSOLE_OUTPUT) - Understanding logging
- [Speaker Diarization](/features/SPEAKER_DIARIZATION) - Diarization system details
