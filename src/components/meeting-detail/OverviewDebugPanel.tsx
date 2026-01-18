/**
 * Overview Debug Panel Component
 *
 * A developer-only debug panel that shows:
 * - Overview tab render tree
 * - Section order with indices
 * - Data presence for each section
 * - Generation timestamps
 *
 * This panel is used to diagnose why Meeting Summary may not be displaying
 * properly in the Overview tab.
 */

import { useState, useMemo } from 'react'
import {
  Bug,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  AlertCircle,
  Clock,
  FileText,
  Sparkles,
  CheckSquare,
  Gavel,
  Hash,
  ThumbsUp,
  Copy
} from 'lucide-react'
import type { MeetingNote, Task } from '../../types/database'
import type { ExtractedTopic, SentimentType } from '../../types/electron-api'

interface OverviewDebugPanelProps {
  meetingId: string
  notes: MeetingNote[]
  tasks: Task[]
  topics: ExtractedTopic[]
  overallSentiment?: SentimentType
  isOpen: boolean
  onClose: () => void
}

interface SectionDebugInfo {
  name: string
  index: number
  exists: boolean
  count: number
  icon: React.ReactNode
  details?: Record<string, unknown>
}

export function OverviewDebugPanel({
  meetingId,
  notes,
  tasks,
  topics,
  overallSentiment,
  isOpen,
  onClose
}: OverviewDebugPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['summary']))

  // Analyze sections
  const sectionAnalysis = useMemo((): SectionDebugInfo[] => {
    const summaryNotes = notes.filter(n => n.note_type === 'summary')
    const aiSummaryNotes = summaryNotes.filter(n => n.is_ai_generated)
    const customNotes = notes.filter(n => n.note_type === 'custom' || (!n.is_ai_generated && n.note_type !== 'summary'))
    const decisionNotes = notes.filter(n => n.note_type === 'decision')

    return [
      {
        name: 'Meeting Summary',
        index: 0,
        exists: summaryNotes.length > 0,
        count: summaryNotes.length,
        icon: <Sparkles className="w-4 h-4" />,
        details: {
          totalSummaryNotes: summaryNotes.length,
          aiGeneratedSummaryNotes: aiSummaryNotes.length,
          latestGenerationTimestamp: aiSummaryNotes[0]?.generation_timestamp || aiSummaryNotes[0]?.created_at || 'N/A',
          summaryNoteIds: summaryNotes.map(n => n.id),
          contentLengths: summaryNotes.map(n => ({
            id: n.id,
            words: n.content.split(/\s+/).length,
            characters: n.content.length,
          })),
          hasSentimentAnalysis: summaryNotes.some(n => n.content.includes('Meeting Sentiment Analysis')),
        }
      },
      {
        name: 'Notes',
        index: 1,
        exists: customNotes.length > 0,
        count: customNotes.length,
        icon: <FileText className="w-4 h-4" />,
        details: {
          totalCustomNotes: customNotes.length,
          noteIds: customNotes.map(n => n.id),
        }
      },
      {
        name: 'Action Items',
        index: 2,
        exists: tasks.length > 0,
        count: tasks.length,
        icon: <CheckSquare className="w-4 h-4" />,
        details: {
          totalTasks: tasks.length,
          byStatus: {
            pending: tasks.filter(t => t.status === 'pending').length,
            in_progress: tasks.filter(t => t.status === 'in_progress').length,
            completed: tasks.filter(t => t.status === 'completed').length,
          },
          createdDuringRecording: tasks.filter(t => t.created_during_recording).length,
        }
      },
      {
        name: 'Decisions',
        index: 3,
        exists: decisionNotes.length > 0,
        count: decisionNotes.length,
        icon: <Gavel className="w-4 h-4" />,
        details: {
          totalDecisions: decisionNotes.length,
          decisionIds: decisionNotes.map(n => n.id),
        }
      },
      {
        name: 'Topics',
        index: 4,
        exists: topics.length > 0,
        count: topics.length,
        icon: <Hash className="w-4 h-4" />,
        details: {
          totalTopics: topics.length,
          topicNames: topics.map(t => t.name),
        }
      },
      {
        name: 'Overall Sentiment',
        index: 5,
        exists: overallSentiment !== undefined,
        count: overallSentiment ? 1 : 0,
        icon: <ThumbsUp className="w-4 h-4" />,
        details: {
          sentiment: overallSentiment || 'N/A',
        }
      },
    ]
  }, [notes, tasks, topics, overallSentiment])

  // Get all note types present
  const noteTypesPresent = useMemo(() => {
    return [...new Set(notes.map(n => n.note_type))]
  }, [notes])

  const toggleSection = (name: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const copyDiagnostics = () => {
    const diagnostics = {
      meetingId,
      timestamp: new Date().toISOString(),
      sections: sectionAnalysis,
      noteTypesPresent,
      rawCounts: {
        totalNotes: notes.length,
        totalTasks: tasks.length,
        totalTopics: topics.length,
      }
    }
    navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))
      .then(() => alert('Diagnostics copied to clipboard'))
      .catch(err => console.error('Failed to copy:', err))
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      data-testid="overview-debug-panel-backdrop"
    >
      <div
        className="bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
        data-testid="overview-debug-panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <Bug className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <h2 className="font-semibold text-foreground">Overview Tab Debug Panel</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyDiagnostics}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
              title="Copy diagnostics to clipboard"
            >
              <Copy className="w-4 h-4" />
              Copy
            </button>
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[calc(80vh-120px)]">
          {/* Meeting ID */}
          <div className="mb-4 p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Meeting ID:</span>
              <code className="text-sm font-mono text-foreground">{meetingId}</code>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-sm font-medium text-muted-foreground">Note Types Present:</span>
              <div className="flex gap-1">
                {noteTypesPresent.map(type => (
                  <span
                    key={type}
                    className="px-2 py-0.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded"
                  >
                    {type}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Section Render Tree */}
          <h3 className="text-sm font-semibold text-foreground mb-3">Section Render Tree</h3>
          <div className="space-y-2">
            {sectionAnalysis.map((section) => (
              <div
                key={section.name}
                className={`border rounded-lg overflow-hidden ${
                  section.exists
                    ? 'border-green-200 dark:border-green-800'
                    : 'border-amber-200 dark:border-amber-800'
                }`}
                data-testid={`debug-section-${section.name.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {/* Section Header */}
                <button
                  onClick={() => toggleSection(section.name)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${
                    section.exists
                      ? 'bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30'
                      : 'bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`flex-shrink-0 ${
                      section.exists
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}>
                      {section.icon}
                    </span>
                    <span className="font-medium text-sm text-foreground">
                      {section.index}. {section.name}
                    </span>
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                      section.exists
                        ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                        : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                    }`}>
                      {section.count} items
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {section.exists ? (
                      <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    )}
                    {expandedSections.has(section.name) ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {/* Section Details */}
                {expandedSections.has(section.name) && section.details && (
                  <div className="px-3 py-2 bg-background border-t border-border/50">
                    <dl className="space-y-1.5 text-xs">
                      {Object.entries(section.details).map(([key, value]) => (
                        <div key={key} className="flex justify-between items-start gap-4">
                          <dt className="font-medium text-muted-foreground whitespace-nowrap">
                            {key}:
                          </dt>
                          <dd className="font-mono text-foreground text-right break-all">
                            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Missing Summary Diagnostic */}
          {!sectionAnalysis[0].exists && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-red-700 dark:text-red-300 text-sm">
                    Meeting Summary Missing
                  </h4>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                    No summary notes were found for this meeting. This could be because:
                  </p>
                  <ul className="mt-2 text-xs text-red-600 dark:text-red-400 list-disc list-inside space-y-1">
                    <li>Summary generation has not been triggered yet</li>
                    <li>Summary generation failed or is still in progress</li>
                    <li>The meeting has no transcripts to summarize</li>
                    <li>Database query did not return summary notes</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              <Clock className="w-3 h-3 inline mr-1" />
              Debug panel opened at {new Date().toLocaleTimeString()}
            </span>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default OverviewDebugPanel
