/**
 * Settings Panel Component
 *
 * A comprehensive settings panel that combines AudioSettings and LLMSettings.
 * Provides a unified interface for configuring audio devices (microphone, system audio)
 * and LLM settings (LM Studio URL, model selection).
 * All settings are persisted to electron-store via the settings service.
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Mic,
  Brain,
  Users,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { AudioDeviceSettings } from './AudioDeviceSettings'
import { LLMSettings } from './LLMSettings'
import { DiarizationSettings, type DiarizationUserSettings } from './DiarizationSettings'

// ============================================================================
// Types
// ============================================================================

interface SettingsPanelProps {
  className?: string
  defaultExpandedSections?: string[]
  onAudioDeviceChange?: (inputDevice: string, outputDevice: string) => void
  onLLMSettingsChange?: (settings: { provider: string; lmStudioUrl: string; model: string }) => void
  onDiarizationSettingsChange?: (settings: DiarizationUserSettings) => void
}

interface CollapsibleSectionProps {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  isExpanded: boolean
  onToggle: () => void
  children: React.ReactNode
}

// ============================================================================
// Collapsible Section Component
// ============================================================================

function CollapsibleSection({
  id,
  title,
  description,
  icon,
  isExpanded,
  onToggle,
  children
}: CollapsibleSectionProps) {
  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden" data-testid={`section-${id}`}>
      <button
        onClick={onToggle}
        className={cn(
          'w-full px-6 py-4 flex items-center justify-between',
          'hover:bg-accent/50 transition-colors',
          isExpanded && 'border-b border-border'
        )}
        aria-expanded={isExpanded}
        data-testid={`section-toggle-${id}`}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg">
            {icon}
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-5 w-5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        )}
      </button>
      {isExpanded && (
        <div className="p-6">
          {children}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main SettingsPanel Component
// ============================================================================

export function SettingsPanel({
  className,
  defaultExpandedSections = ['audio', 'llm', 'diarization'],
  onAudioDeviceChange,
  onLLMSettingsChange,
  onDiarizationSettingsChange
}: SettingsPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(defaultExpandedSections)
  )

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId)
      } else {
        newSet.add(sectionId)
      }
      return newSet
    })
  }

  const handleAudioDeviceChange = (inputDevice: string, outputDevice: string) => {
    console.log('Audio devices changed:', { inputDevice, outputDevice })
    onAudioDeviceChange?.(inputDevice, outputDevice)
  }

  const handleLLMSettingsChange = (settings: { provider: string; lmStudioUrl: string; model: string }) => {
    console.log('LLM settings changed:', settings)
    onLLMSettingsChange?.(settings)
  }

  const handleDiarizationSettingsChange = (settings: DiarizationUserSettings) => {
    console.log('Diarization settings changed:', settings)
    onDiarizationSettingsChange?.(settings)
  }

  return (
    <div className={cn('space-y-6', className)} data-testid="settings-panel">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-foreground">Configuration Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure your audio devices and AI settings
        </p>
      </div>

      {/* Audio Settings Section */}
      <CollapsibleSection
        id="audio"
        title="Audio Settings"
        description="Configure microphone and system audio capture"
        icon={<Mic className="h-5 w-5 text-purple-600" />}
        isExpanded={expandedSections.has('audio')}
        onToggle={() => toggleSection('audio')}
      >
        <AudioDeviceSettings onDeviceChange={handleAudioDeviceChange} />
      </CollapsibleSection>

      {/* Speaker Identification Settings Section */}
      <CollapsibleSection
        id="diarization"
        title="Speaker Identification"
        description="Configure automatic speaker detection and fallback behavior"
        icon={<Users className="h-5 w-5 text-purple-600" />}
        isExpanded={expandedSections.has('diarization')}
        onToggle={() => toggleSection('diarization')}
      >
        <DiarizationSettings onSettingsChange={handleDiarizationSettingsChange} />
      </CollapsibleSection>

      {/* LLM Settings Section */}
      <CollapsibleSection
        id="llm"
        title="AI / LLM Settings"
        description="Configure LM Studio URL and model selection"
        icon={<Brain className="h-5 w-5 text-purple-600" />}
        isExpanded={expandedSections.has('llm')}
        onToggle={() => toggleSection('llm')}
      >
        <LLMSettings onSettingsChange={handleLLMSettingsChange} />
      </CollapsibleSection>

      {/* Footer Info */}
      <div className="text-xs text-muted-foreground text-center">
        Settings are automatically saved to local storage
      </div>
    </div>
  )
}

export default SettingsPanel
