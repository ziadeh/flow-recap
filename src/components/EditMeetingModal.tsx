import React, { useState, useEffect, useRef } from 'react';
import { Modal } from './Modal';
import { Loader2, AlertCircle } from 'lucide-react';
import type { Meeting } from '../types/database';

interface EditMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: Meeting;
  onSuccess?: () => void;
}

type MeetingType = 'one-on-one' | 'team' | 'webinar' | 'other';

interface FormData {
  title: string;
  description: string;
  meetingType: MeetingType;
  scheduledTime: string;
}

interface FormErrors {
  title?: string;
  description?: string;
  scheduledTime?: string;
}

const meetingTypeOptions: { value: MeetingType; label: string }[] = [
  { value: 'one-on-one', label: 'One-on-One' },
  { value: 'team', label: 'Team Meeting' },
  { value: 'webinar', label: 'Webinar' },
  { value: 'other', label: 'Other' },
];

// Helper to format ISO date string to datetime-local format
function formatToDateTimeLocal(isoString: string): string {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

export function EditMeetingModal({ isOpen, onClose, meeting, onSuccess }: EditMeetingModalProps) {
  const titleInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<FormData>({
    title: meeting.title,
    description: meeting.description || '',
    meetingType: meeting.meeting_type,
    scheduledTime: formatToDateTimeLocal(meeting.start_time),
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Update form data when meeting changes
  useEffect(() => {
    if (isOpen) {
      setFormData({
        title: meeting.title,
        description: meeting.description || '',
        meetingType: meeting.meeting_type,
        scheduledTime: formatToDateTimeLocal(meeting.start_time),
      });
      setErrors({});
      setSubmitError(null);
    }
  }, [meeting, isOpen]);

  // Auto-focus title input when modal opens
  useEffect(() => {
    if (isOpen && titleInputRef.current) {
      setTimeout(() => titleInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Validate title
    if (!formData.title.trim()) {
      newErrors.title = 'Title is required';
    } else if (formData.title.length > 200) {
      newErrors.title = 'Title must be 200 characters or less';
    }

    // Validate description
    if (formData.description.length > 1000) {
      newErrors.description = 'Description must be 1000 characters or less';
    }

    // Validate scheduled time
    if (formData.scheduledTime) {
      const scheduledDate = new Date(formData.scheduledTime);
      if (isNaN(scheduledDate.getTime())) {
        newErrors.scheduledTime = 'Invalid date/time format';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const input = {
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        meeting_type: formData.meetingType,
        start_time: new Date(formData.scheduledTime).toISOString(),
      };

      await window.electronAPI.db.meetings.update(meeting.id, input);

      // Call success callback if provided
      if (onSuccess) {
        onSuccess();
      }

      // Close modal
      onClose();
    } catch (error) {
      console.error('Failed to update meeting:', error);
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'Failed to update meeting. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    // Clear error for this field when user starts typing
    if (errors[name as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Meeting" size="md">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Global error message */}
        {submitError && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
            <AlertCircle className="text-red-600 mt-0.5 flex-shrink-0" size={18} />
            <p className="text-sm text-red-600">{submitError}</p>
          </div>
        )}

        {/* Title field */}
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-foreground mb-1.5">
            Title <span className="text-red-600">*</span>
          </label>
          <input
            ref={titleInputRef}
            type="text"
            id="title"
            name="title"
            value={formData.title}
            onChange={handleInputChange}
            className={`w-full px-3 py-2 bg-background border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-600 ${
              errors.title ? 'border-red-500' : 'border-border'
            }`}
            placeholder="Enter meeting title"
            maxLength={200}
            disabled={isSubmitting}
            aria-describedby={errors.title ? 'title-error' : undefined}
          />
          {errors.title && (
            <p id="title-error" className="mt-1 text-sm text-red-600">
              {errors.title}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {formData.title.length}/200 characters
          </p>
        </div>

        {/* Meeting Type field */}
        <div>
          <label htmlFor="meetingType" className="block text-sm font-medium text-foreground mb-1.5">
            Meeting Type
          </label>
          <select
            id="meetingType"
            name="meetingType"
            value={formData.meetingType}
            onChange={(e) => setFormData(prev => ({ ...prev, meetingType: e.target.value as MeetingType }))}
            className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-purple-600"
            disabled={isSubmitting}
          >
            {meetingTypeOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Description field */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-foreground mb-1.5">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleInputChange}
            rows={4}
            className={`w-full px-3 py-2 bg-background border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-600 resize-none ${
              errors.description ? 'border-red-500' : 'border-border'
            }`}
            placeholder="Enter meeting description (optional)"
            maxLength={1000}
            disabled={isSubmitting}
            aria-describedby={errors.description ? 'description-error' : undefined}
          />
          {errors.description && (
            <p id="description-error" className="mt-1 text-sm text-red-600">
              {errors.description}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {formData.description.length}/1000 characters
          </p>
        </div>

        {/* Scheduled time field */}
        <div>
          <label htmlFor="scheduledTime" className="block text-sm font-medium text-foreground mb-1.5">
            Scheduled Time
          </label>
          <input
            type="datetime-local"
            id="scheduledTime"
            name="scheduledTime"
            value={formData.scheduledTime}
            onChange={handleInputChange}
            className={`w-full px-3 py-2 bg-background border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-purple-600 ${
              errors.scheduledTime ? 'border-red-500' : 'border-border'
            }`}
            disabled={isSubmitting}
            aria-describedby={errors.scheduledTime ? 'scheduledTime-error' : undefined}
          />
          {errors.scheduledTime && (
            <p id="scheduledTime-error" className="mt-1 text-sm text-red-600">
              {errors.scheduledTime}
            </p>
          )}
        </div>

        {/* Form actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-foreground bg-background border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting && <Loader2 size={16} className="animate-spin" />}
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
