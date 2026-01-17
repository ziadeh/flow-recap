/**
 * Dashboard Page
 *
 * Main landing page showing overview and recent meetings.
 * Optimized for fast initial render by:
 * - Deferring non-critical data fetches
 * - Using lazy loading for heavy components
 * - Showing loading states for async content
 */

import { useState, useEffect, Suspense, lazy, memo } from "react";
import {
  Mic,
  Calendar,
  Clock,
  FileText,
  Plus,
  TrendingUp,
  Users,
  AlertCircle,
  X,
} from "lucide-react";
import { RecordingControls } from "@/components/RecordingControls";
import { useRecording } from "@/hooks";
import { useNewMeeting } from "@/hooks/useNewMeeting";
import { NewMeetingModal } from "@/components/NewMeetingModal";

// Lazy load heavy components for better initial render performance
const TaskOverviewWidget = lazy(
  () => import("@/components/TaskOverviewWidget")
);
const PerformanceProfiler = lazy(
  () => import("@/components/PerformanceProfiler")
);

// Lightweight skeleton placeholder for TaskOverviewWidget while loading
function TaskOverviewSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 bg-muted rounded w-48" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 bg-muted rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  const [versions, setVersions] = useState<{
    node: string;
    chrome: string;
    electron: string;
  } | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const { isModalOpen, openModal, closeModal, handleSuccess } = useNewMeeting();

  // Recording hook - now optimized to avoid heavy operations when idle
  const {
    status,
    meetingId,
    duration,
    audioLevel,
    deviceUsed,
    deviceWarning,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording
  } = useRecording();

  // Wrap recording handlers to match RecordingControls interface
  const handleStartRecording = async () => {
    await startRecording();
  };

  const handleStopRecording = async () => {
    await stopRecording();
  };

  const handlePauseRecording = async () => {
    await pauseRecording();
  };

  const handleResumeRecording = async () => {
    await resumeRecording();
  };

  useEffect(() => {
    // Access electron API if available
    if (window.electronAPI) {
      setVersions(window.electronAPI.versions);
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Recording Error Banner */}
      {recordingError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-red-900">Recording Error</p>
              <p className="text-sm text-red-800 mt-1">{recordingError}</p>
            </div>
            <button
              onClick={() => setRecordingError(null)}
              className="text-red-600 hover:text-red-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Recording Controls with Live Speaker Detection - Only show when recording is active */}
      {(status === 'recording' || status === 'paused' || status === 'stopping') && (
        <RecordingControls
          status={status}
          duration={duration}
          audioLevel={audioLevel}
          deviceUsed={deviceUsed}
          deviceWarning={deviceWarning}
          meetingId={meetingId || undefined}
          onStart={handleStartRecording}
          onStop={handleStopRecording}
          onPause={handlePauseRecording}
          onResume={handleResumeRecording}
        />
      )}

      {/* Welcome Section */}
      <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
        <h2 className="text-2xl font-semibold mb-4 text-foreground">
          Welcome to FlowRecap
        </h2>
        <p className="text-muted-foreground mb-4">
          Your AI-powered meeting assistant for capturing, transcribing, and
          organizing meeting notes.
        </p>
        <ul className="flex flex-wrap gap-3 mb-6">
          <li className="px-3 py-1 bg-secondary text-secondary-foreground rounded-md text-sm">
            Vite
          </li>
          <li className="px-3 py-1 bg-secondary text-secondary-foreground rounded-md text-sm">
            React 18.3+
          </li>
          <li className="px-3 py-1 bg-secondary text-secondary-foreground rounded-md text-sm">
            TypeScript
          </li>
          <li className="px-3 py-1 bg-secondary text-secondary-foreground rounded-md text-sm">
            Electron
          </li>
        </ul>

        {versions && (
          <div className="mt-6 pt-6 border-t border-border">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              Environment
            </h3>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Node: {versions.node}</p>
              <p>Chrome: {versions.chrome}</p>
              <p>Electron: {versions.electron}</p>
            </div>
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          label="Total Meetings"
          value="0"
          color="purple"
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Hours Recorded"
          value="0"
          color="blue"
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Participants"
          value="0"
          color="green"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="This Week"
          value="0"
          color="orange"
        />
      </div>

      {/* Task Overview Widget - wrapped in Suspense for graceful loading */}
      <Suspense fallback={<TaskOverviewSkeleton />}>
        <TaskOverviewWidget />
      </Suspense>

      {/* Quick Actions */}
      <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 text-foreground">
          Quick Actions
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <QuickActionCard
            icon={<Mic className="h-6 w-6" />}
            title="Start Recording"
            description="Begin a new meeting recording"
            action="Start"
          />
          <QuickActionCard
            icon={<Calendar className="h-6 w-6" />}
            title="View Meetings"
            description="Browse your meeting history"
            action="View"
          />
          <QuickActionCard
            icon={<Plus className="h-6 w-6" />}
            title="New Meeting"
            description="Create a new meeting manually"
            action="Create"
            onClick={openModal}
          />
        </div>
      </div>

      <NewMeetingModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />

      {/* Performance Profiler - Development Only */}
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <PerformanceProfiler />
        </Suspense>
      )}
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: "purple" | "blue" | "green" | "orange";
}

const StatCard = memo(function StatCard({
  icon,
  label,
  value,
  color,
}: StatCardProps) {
  const colors = {
    purple: "bg-purple-100 text-purple-600",
    blue: "bg-blue-100 text-blue-600",
    green: "bg-green-100 text-green-600",
    orange: "bg-orange-100 text-orange-600",
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}>{icon}</div>
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </div>
    </div>
  );
});

interface QuickActionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: string;
  onClick?: () => void;
}

const QuickActionCard = memo(function QuickActionCard({
  icon,
  title,
  description,
  action,
  onClick,
}: QuickActionCardProps) {
  return (
    <div
      onClick={onClick}
      className={`border border-border rounded-lg p-4 hover:bg-accent/50 transition-colors ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 bg-secondary rounded-lg text-muted-foreground">
          {icon}
        </div>
        <div className="flex-1">
          <h4 className="font-medium text-foreground">{title}</h4>
          <p className="text-sm text-muted-foreground mb-3">{description}</p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
            className="text-sm text-purple-600 hover:text-purple-700 font-medium"
          >
            {action} &rarr;
          </button>
        </div>
      </div>
    </div>
  );
});

export default Dashboard;
