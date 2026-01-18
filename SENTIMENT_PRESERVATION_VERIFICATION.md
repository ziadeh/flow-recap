# Sentiment Preservation Verification Guide

## Feature Overview
This document describes how to manually verify that the 'Overall Sentiment' field is preserved when regenerating insights.

## Implementation Changes

### 1. UnifiedInsightsButton.tsx
- Updated to pass `preserveSentiment: true` when deleting existing insights during regeneration
- This ensures the sentiment analysis note is not deleted before regeneration

### 2. unifiedInsightsService.ts
- Enhanced `deleteExistingInsights()` to skip deletion of sentiment notes when `preserveSentiment` option is enabled
- Added console logging for better debugging

### 3. decisionsAndTopicsService.ts
- Updated LLM prompt to explicitly request sentiment analysis with clear requirements
- Added `getCachedSentiment()` method to retrieve existing sentiment from database
- Added fallback logic in `createNotesFromExtraction()` to use cached sentiment if LLM doesn't return valid sentiment
- Ensures sentiment is always populated, either from new LLM response or from cached value

## Manual Verification Steps

### Prerequisites
- Build the app: `npm run build`
- Ensure you have an LLM provider running (LM Studio, Claude CLI, or Cursor CLI)

### Test Procedure

1. **Start the application**
   ```bash
   npm run start
   ```

2. **Create a test meeting with transcripts**
   - Create a new meeting
   - Add at least 6 sample transcript segments with varied sentiment (positive and negative statements)
   - Example transcripts:
     - "Great to see everyone today! I'm really excited about this project."
     - "I'm concerned about the timeline though. We might be falling behind."
     - "That's a valid point. Let's discuss how we can address this."

3. **Generate initial insights**
   - Navigate to the Insights tab
   - Click "Generate All Insights"
   - Wait for generation to complete
   - Verify that "Sentiment Analysis" section appears with:
     - Overall Sentiment (Positive/Negative/Neutral/Mixed)
     - Sentiment Breakdown percentages
     - Statistics (decisions, key points, topics counts)

4. **Note the initial sentiment**
   - Record the "Overall Sentiment" value (e.g., "Mixed" or "Positive")
   - Record the sentiment breakdown percentages

5. **Regenerate insights (1st time)**
   - Click "Replace Existing Insights" button
   - Confirm the replacement in the dialog
   - Wait for regeneration to complete

6. **Verify sentiment is preserved**
   - Check that the "Sentiment Analysis" section still exists
   - Verify the "Overall Sentiment" field is populated (not blank)
   - The sentiment should be either:
     a. A new valid sentiment from the LLM, OR
     b. The same sentiment as before (if LLM didn't return sentiment)

7. **Regenerate insights (2nd time)**
   - Click "Replace Existing Insights" again
   - Confirm the replacement
   - Wait for regeneration to complete

8. **Final verification**
   - Sentiment Analysis section should still exist
   - Overall Sentiment should be populated
   - There should be exactly 1 Sentiment Analysis note (not duplicated)

## Expected Behavior

### ✅ Success Criteria
- Sentiment field is ALWAYS populated after regeneration
- Sentiment is not cleared or set to blank/null
- Only 1 sentiment note exists (no duplication)
- Console logs show sentiment preservation:
  ```
  [UnifiedInsights] Preserving existing sentiment analysis note: <note-id>
  [UnifiedInsights] Deleted X insights, preserved sentiment: true
  ```

### ❌ Failure Criteria
- Sentiment field becomes blank after regeneration
- Multiple sentiment notes are created
- Sentiment is lost between regenerations

## Console Debugging

Open Developer Tools (Cmd/Ctrl + Shift + I) and check console for:

1. **During deletion:**
   ```
   [UnifiedInsights] Preserving existing sentiment analysis note: <id>
   [UnifiedInsights] Deleted X insights, preserved sentiment: true
   ```

2. **During regeneration:**
   ```
   [DecisionsAndTopics] Found cached sentiment: <sentiment> {...}
   [DecisionsAndTopics] Using cached sentiment as fallback
   ```

## Fallback Logic

The implementation has two levels of protection:

1. **Preservation**: Existing sentiment note is NOT deleted during regeneration
2. **Fallback**: If LLM doesn't return sentiment (or returns default values), the cached sentiment is used

This ensures sentiment is NEVER lost during regeneration.

## Code References

- **UI Component**: `src/components/meeting-detail/UnifiedInsightsButton.tsx` (line 536)
- **Service Layer**: `electron/services/unifiedInsightsService.ts` (lines 181-217)
- **LLM Integration**: `electron/services/decisionsAndTopicsService.ts` (lines 873-1056)

## Troubleshooting

### Sentiment is blank after regeneration
- Check console logs for errors
- Verify LLM is responding correctly
- Check if cached sentiment was found: search for `[DecisionsAndTopics] Found cached sentiment`

### Multiple sentiment notes created
- This should not happen with the current implementation
- Check `preserveSentiment` flag is being passed correctly
- Verify `deleteExistingInsights` is preserving the sentiment note

### Sentiment changes unexpectedly
- This is expected if the LLM generates a new valid sentiment
- The cached sentiment is only used as a fallback when LLM doesn't return sentiment
- Check console for: `[DecisionsAndTopics] Using cached sentiment as fallback`
