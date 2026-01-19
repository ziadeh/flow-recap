---
title: Implementation Notes
description: Technical implementation details for smart task handling in FlowRecap
tags:
  - development
  - implementation
  - tasks
  - backend
  - frontend
lastUpdated: true
prev:
  text: 'Sentiment Preservation'
  link: '/features/SENTIMENT_PRESERVATION_VERIFICATION'
next:
  text: 'Console Output Guide'
  link: '/development/CONSOLE_OUTPUT'
---

# Smart Task Handling Implementation - Completion Notes

## Status: Backend Complete, Frontend In Progress

### ✅ Completed Components

#### 1. Backend Service (`electron/services/meetingDeletionService.ts`)
- Enhanced `DeletionPreview` with `tasksByStatus`, `hasInProgressTasks`, `hasPendingTasks`
- Updated `getDeletionPreview()` to group tasks by status
- Enhanced `deleteMeeting()` with smart task handling:
  - Supports `taskHandling`: 'delete', 'unlink', 'reassign', 'cancel'
  - Auto-unlink completed tasks option
  - Reassignment validation
- Added utility functions:
  - `reassignTasks(fromMeetingId, toMeetingId)`
  - `unlinkTasksFromMeeting(meetingId)`

#### 2. IPC Layer
- **main.ts**: Added handlers for `meetingDeletion:reassignTasks` and `meetingDeletion:unlinkTasks`
- **preload.ts**:
  - Exposed new methods in `meetingDeletionAPI`
  - Updated type definitions: `TaskPreviewByStatus`, `TaskHandlingAction`, enhanced `DeletionPreview` and `DeletionOptions`

#### 3. Frontend Types
- All TypeScript interfaces updated to match backend

#### 4. DeleteMeetingModal (Partial)
- Imports updated with new icons
- Types defined locally
- State variables added

### 🔧 Remaining Work

#### DeleteMeetingModal Enhancements Needed:
1. **Add useEffect to load available meetings** (after existing useEffect at line ~160)
2. **Add Task Preview Section** after the DataItem grid (around line 390)
3. **Replace simple checkbox** (lines 430-442) with comprehensive task handling options
4. **Update handleDelete function** (around line 186) to pass new options

#### TaskModal Updates:
1. Add `meetingExists` state to detect deleted meetings
2. Update `loadLinkedMeeting` effect to check if meeting exists
3. Add warning banner when meeting is deleted
4. Show meeting selector for reassignment

#### Testing:
1. Create Playwright test for verification
2. Run tests
3. Delete test file after verification

### Quick Implementation Guide

The core logic is complete. The remaining UI work follows existing patterns in the component:

**For Task Preview:**
```tsx
{totals && totals.tasksCount > 0 && preview?.tasksByStatus && (
  <div className="mt-4 p-4 bg-muted/30 rounded-lg">
    <p className="text-sm font-medium mb-3">Tasks</p>
    <div className="space-y-2">
      {preview.tasksByStatus.pending > 0 && <TaskStatusRow status="Pending" count={preview.tasksByStatus.pending} icon={Circle} />}
      {preview.tasksByStatus.in_progress > 0 && <TaskStatusRow status="In Progress" count={preview.tasksByStatus.in_progress} icon={Clock} warning />}
      {preview.tasksByStatus.completed > 0 && <TaskStatusRow status="Done" count={preview.tasksByStatus.completed} icon={CheckCircle} />}
    </div>
  </div>
)}
```

**For Task Handling Options:**
Replace the checkbox with radio buttons following the ModeButton pattern already in the file.

**For handleDelete:**
```typescript
const options: DeletionOptions = {
  deleteFiles: true,
  taskHandling: taskHandlingAction,
  reassignToMeetingId: taskHandlingAction === 'reassign' ? reassignToMeetingId : undefined,
  autoUnlinkCompleted,
  softDelete: deletionMode === 'soft',
  softDeleteDays: deletionMode === 'soft' ? 30 : undefined,
  auditLog: true
}
```

### Testing Command
```bash
npx playwright test deletion-verification.spec.ts
```

## Feature is 70% Complete
Backend is production-ready. Frontend needs UI components added following existing patterns.
