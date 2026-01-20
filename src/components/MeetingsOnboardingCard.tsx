/**
 * Meetings Onboarding Card Component
 *
 * Illustrated onboarding card that explains FlowRecap's core workflow
 * and provides clear next steps for new users facing an empty meeting list.
 */

import { useNavigate } from 'react-router-dom'
import {
  Mic,
  Sparkles,
  CheckSquare,
  ArrowRight,
  Settings,
  ChevronRight
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface MeetingsOnboardingCardProps {
  /** Callback when the user wants to start their first recording */
  onStartRecording?: () => void
  /** Optional class name for additional styling */
  className?: string
}

interface WorkflowStepProps {
  icon: React.ReactNode
  iconBg: string
  title: string
  description: string
  stepNumber: number
}

function WorkflowStep({ icon, iconBg, title, description, stepNumber }: WorkflowStepProps) {
  return (
    <div className="flex items-start gap-4 relative">
      {/* Step connector line */}
      {stepNumber < 3 && (
        <div className="absolute left-5 top-12 w-0.5 h-8 bg-gradient-to-b from-purple-200 to-transparent dark:from-purple-800 dark:to-transparent" />
      )}

      {/* Icon container */}
      <div className={cn(
        'flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center',
        iconBg
      )}>
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-1">
        <h4 className="text-sm font-semibold text-foreground mb-1">{title}</h4>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

export function MeetingsOnboardingCard({ onStartRecording, className }: MeetingsOnboardingCardProps) {
  const navigate = useNavigate()

  const handleStartRecording = () => {
    if (onStartRecording) {
      onStartRecording()
    } else {
      navigate('/')
    }
  }

  const handleOpenSettings = () => {
    navigate('/settings')
  }

  return (
    <div className={cn('p-8 md:p-12', className)} data-testid="meetings-onboarding-card">
      {/* Header Section */}
      <div className="text-center mb-10">
        {/* Illustration/Logo */}
        <div className="relative inline-flex items-center justify-center mb-6">
          {/* Background glow effect */}
          <div className="absolute inset-0 bg-purple-500/20 dark:bg-purple-500/10 rounded-full blur-2xl scale-150" />

          {/* Main icon container */}
          <div className="relative w-20 h-20 bg-gradient-to-br from-purple-500 to-purple-700 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-500/25">
            <Mic className="h-10 w-10 text-white" />
          </div>

          {/* Sparkle decorations */}
          <div className="absolute -top-1 -right-1 w-6 h-6 bg-amber-400 dark:bg-amber-500 rounded-lg flex items-center justify-center shadow-md">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
        </div>

        <h2 className="text-2xl font-bold text-foreground mb-3">
          Welcome to FlowRecap
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto leading-relaxed">
          Transform your meetings into actionable insights. Record conversations,
          get AI-powered summaries, and never miss an action item again.
        </p>
      </div>

      {/* Workflow Steps */}
      <div className="max-w-md mx-auto mb-10 space-y-6">
        <WorkflowStep
          stepNumber={1}
          icon={<Mic className="h-5 w-5 text-purple-600 dark:text-purple-400" />}
          iconBg="bg-purple-100 dark:bg-purple-900/40"
          title="Record Your Meetings"
          description="Capture audio from any meeting app with automatic transcription and speaker identification."
        />

        <WorkflowStep
          stepNumber={2}
          icon={<Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
          iconBg="bg-amber-100 dark:bg-amber-900/40"
          title="Get AI Insights"
          description="Instantly receive smart summaries, key discussion points, and decisions made during the meeting."
        />

        <WorkflowStep
          stepNumber={3}
          icon={<CheckSquare className="h-5 w-5 text-green-600 dark:text-green-400" />}
          iconBg="bg-green-100 dark:bg-green-900/40"
          title="Track Action Items"
          description="Automatically extract and organize tasks with assignees and due dates for easy follow-up."
        />
      </div>

      {/* CTA Section */}
      <div className="flex flex-col items-center gap-4">
        {/* Primary CTA */}
        <button
          onClick={handleStartRecording}
          className="group inline-flex items-center gap-3 px-8 py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-base font-semibold transition-all duration-200 shadow-lg shadow-purple-600/25 hover:shadow-xl hover:shadow-purple-600/30 hover:-translate-y-0.5"
          data-testid="record-first-meeting-cta"
        >
          <Mic className="h-5 w-5" />
          Record Your First Meeting
          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
        </button>

        {/* Secondary Link */}
        <button
          onClick={handleOpenSettings}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          data-testid="audio-setup-link"
        >
          <Settings className="h-4 w-4" />
          Configure audio settings first
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Help Text */}
      <p className="text-center text-xs text-muted-foreground mt-8">
        Need help setting up? Check the{' '}
        <button
          onClick={handleOpenSettings}
          className="text-purple-600 dark:text-purple-400 hover:underline font-medium"
        >
          audio setup wizard
        </button>{' '}
        in settings.
      </p>
    </div>
  )
}

export default MeetingsOnboardingCard
