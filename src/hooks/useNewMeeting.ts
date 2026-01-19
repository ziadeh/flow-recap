import { useState, useCallback } from 'react';
import { useMeetingListStore } from '@/stores/meeting-list-store';
import type { Meeting } from '@/types/database';

export function useNewMeeting() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Get store actions using individual selectors to prevent re-render issues
  const setMeetings = useMeetingListStore(state => state.setMeetings);
  const meetings = useMeetingListStore(state => state.meetings);
  const invalidateCache = useMeetingListStore(state => state.invalidateCache);

  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  /**
   * Handle successful meeting creation by updating the meeting list store.
   * This ensures the new meeting appears immediately in the list without
   * waiting for the cache to expire.
   */
  const handleSuccess = useCallback((meeting: Meeting) => {
    console.log('Meeting created successfully:', meeting.id);

    // Add the new meeting to the beginning of the list (newest first)
    const exists = meetings.some((m) => m.id === meeting.id);
    if (!exists) {
      setMeetings([meeting, ...meetings], false);
    }

    // Also invalidate the cache to ensure next background fetch gets fresh data
    invalidateCache();
  }, [meetings, setMeetings, invalidateCache]);

  return {
    isModalOpen,
    openModal,
    closeModal,
    handleSuccess,
  };
}
