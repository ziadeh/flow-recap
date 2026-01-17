import { useState, useCallback } from 'react';

export function useNewMeeting() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleSuccess = useCallback((meetingId: string) => {
    console.log('Meeting created successfully:', meetingId);
  }, []);

  return {
    isModalOpen,
    openModal,
    closeModal,
    handleSuccess,
  };
}
