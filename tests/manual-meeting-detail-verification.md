# Manual Verification Guide for MeetingDetail Component

This guide helps verify that the MeetingDetail component with tabs works correctly.

## Prerequisites

1. Start the application in dev mode:
   ```bash
   npm run dev
   ```

2. The application should open automatically.

## Test Steps

### 1. Create Test Data

First, we need to create a test meeting with some data. Open the DevTools console (View > Developer > Toggle Developer Tools) and run:

```javascript
// Create test meeting
const meeting = await window.electronAPI.db.meetings.create({
  title: 'Test Meeting for Verification',
  description: 'This is a test meeting to verify the MeetingDetail component',
  start_time: new Date().toISOString(),
  status: 'completed'
})

console.log('Created meeting:', meeting.id)

// Create test speaker
const speaker = await window.electronAPI.db.speakers.create({
  name: 'John Doe',
  email: 'john@example.com'
})

// Create test transcripts
await window.electronAPI.db.transcripts.create({
  meeting_id: meeting.id,
  speaker_id: speaker.id,
  content: 'Hello everyone, welcome to this meeting.',
  start_time_ms: 1000,
  end_time_ms: 5000,
  confidence: 0.95,
  is_final: true
})

await window.electronAPI.db.transcripts.create({
  meeting_id: meeting.id,
  speaker_id: speaker.id,
  content: 'Today we are going to discuss the quarterly results.',
  start_time_ms: 5500,
  end_time_ms: 9000,
  confidence: 0.92,
  is_final: true
})

// Create test notes
await window.electronAPI.db.meetingNotes.create({
  meeting_id: meeting.id,
  content: 'This meeting covered quarterly results and future planning.',
  note_type: 'summary',
  is_ai_generated: true
})

await window.electronAPI.db.meetingNotes.create({
  meeting_id: meeting.id,
  content: 'Discussed Q4 revenue growth of 25%.',
  note_type: 'key_point',
  is_ai_generated: false
})

await window.electronAPI.db.meetingNotes.create({
  meeting_id: meeting.id,
  content: 'Follow up with finance team on budget allocation.',
  note_type: 'action_item',
  is_ai_generated: false
})

// Create test tasks
await window.electronAPI.db.tasks.create({
  meeting_id: meeting.id,
  title: 'Prepare Q4 report',
  description: 'Compile all financial data for Q4',
  priority: 'high',
  status: 'pending',
  assignee: 'Jane Smith',
  due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days from now
})

await window.electronAPI.db.tasks.create({
  meeting_id: meeting.id,
  title: 'Schedule follow-up meeting',
  description: 'Set up next quarterly review',
  priority: 'medium',
  status: 'completed',
  completed_at: new Date().toISOString()
})

console.log('✓ Test data created successfully!')
console.log('Navigate to: #/meeting/' + meeting.id)
```

### 2. Navigate to Meeting Detail Page

After running the above script, you should see a log message with the meeting ID. Navigate to it by:
- Clicking on "Meetings" in the sidebar
- Looking for "Test Meeting for Verification" in the list
- Clicking on it

OR manually navigate in DevTools console:
```javascript
window.location.hash = '#/meeting/<MEETING_ID>'
```

### 3. Verify Components

Check the following features:

#### ✅ Meeting Header
- [ ] Meeting title displays: "Test Meeting for Verification"
- [ ] Description displays correctly
- [ ] Status badge shows "Completed" in green
- [ ] Date/time displays correctly
- [ ] Speaker name "John Doe" appears in participants section

#### ✅ Audio Player
- [ ] Player shows message "No audio recording available" (since we didn't add an audio file)
- [ ] Message is properly styled in a card

#### ✅ Tab Navigation
- [ ] Three tabs visible: Transcript, Notes, Tasks
- [ ] Each tab shows a count badge (Transcript: 2, Notes: 3, Tasks: 2)
- [ ] Active tab has purple styling
- [ ] URL updates when clicking tabs (e.g., `?tab=notes`)

#### ✅ Transcript Tab (Default)
- [ ] Two transcript entries display
- [ ] Speaker avatar shows "JD" (John Doe initials)
- [ ] Speaker name "John Doe" displays
- [ ] Timestamp displays for each entry (e.g., "0:01")
- [ ] Content text displays correctly
- [ ] Entries are grouped by speaker

#### ✅ Notes Tab
- [ ] Click "Notes" tab
- [ ] Three sections appear: Summary, Key Points, Action Items
- [ ] Summary note has "AI Generated" badge (purple with sparkle icon)
- [ ] Each note shows content correctly
- [ ] Timestamps display
- [ ] Sections are properly organized

#### ✅ Tasks Tab
- [ ] Click "Tasks" tab
- [ ] Filter buttons show: All (2), Pending (1), In Progress (0), Completed (1)
- [ ] Both tasks display with checkboxes
- [ ] "Prepare Q4 report" shows:
  - [ ] High priority badge (red/orange)
  - [ ] Pending status badge
  - [ ] Assignee "Jane Smith"
  - [ ] Due date (7 days from now)
- [ ] "Schedule follow-up meeting" shows:
  - [ ] Medium priority badge
  - [ ] Completed status badge (green)
  - [ ] Checkmark icon
  - [ ] Completion date
- [ ] Click "Pending" filter - only first task shows
- [ ] Click "Completed" filter - only second task shows
- [ ] Click "All" filter - both tasks show

#### ✅ Navigation
- [ ] "Back to Meetings" button appears at top
- [ ] Click it - navigates back to meetings list

### 4. Clean Up Test Data

After verification, clean up the test data. In DevTools console:

```javascript
// Get all meetings
const meetings = await window.electronAPI.db.meetings.getAll()
const testMeeting = meetings.find(m => m.title === 'Test Meeting for Verification')

if (testMeeting) {
  // Delete associated data
  await window.electronAPI.db.transcripts.deleteByMeetingId(testMeeting.id)

  const notes = await window.electronAPI.db.meetingNotes.getByMeetingId(testMeeting.id)
  for (const note of notes) {
    await window.electronAPI.db.meetingNotes.delete(note.id)
  }

  const tasks = await window.electronAPI.db.tasks.getByMeetingId(testMeeting.id)
  for (const task of tasks) {
    await window.electronAPI.db.tasks.delete(task.id)
  }

  await window.electronAPI.db.meetings.delete(testMeeting.id)
  console.log('✓ Test data cleaned up!')
}
```

## Success Criteria

All checkboxes above should be checked (✓). If any feature doesn't work as expected, note the issue and investigate.

## Common Issues

1. **Meeting not found**: Make sure the meeting ID is correct
2. **Data not displaying**: Check browser console for errors
3. **Tabs not working**: Verify React Router is properly configured
4. **Styling issues**: Check that Tailwind CSS is building correctly

## Additional Tests (Optional)

1. **URL Tab Persistence**:
   - Navigate to Notes tab
   - Copy the URL (should have `?tab=notes`)
   - Refresh the page
   - Notes tab should still be active

2. **Empty States**:
   - Create a meeting with no transcripts/notes/tasks
   - Verify empty state messages display correctly

3. **Audio Player with File**:
   - If you have a recording, update the meeting's `audio_file_path`
   - Verify player shows controls instead of "no audio" message
