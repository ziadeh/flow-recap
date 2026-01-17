/**
 * Global type declarations
 * This file augments the Window interface with Electron API types
 */

import type { ExportAPI, UpdateAPI, UpdateState } from './electron-api'

declare global {
  interface Window {
    electronAPI: {
      platform: NodeJS.Platform
      versions: {
        node: string
        chrome: string
        electron: string
      }
      db: {
        meetings: {
          create: (input: any) => Promise<any>
          getById: (id: string) => Promise<any>
          getAll: () => Promise<any[]>
          update: (id: string, input: any) => Promise<any>
          delete: (id: string) => Promise<boolean>
          getByStatus: (status: string) => Promise<any[]>
          getRecent: (limit?: number) => Promise<any[]>
        }
        recordings: {
          create: (input: any) => Promise<any>
          getById: (id: string) => Promise<any>
          getByMeetingId: (meetingId: string) => Promise<any[]>
          update: (id: string, input: any) => Promise<any>
          delete: (id: string) => Promise<boolean>
        }
        transcripts: {
          create: (input: any, options?: any) => Promise<any>
          createBatch: (inputs: any[], options?: any) => Promise<any[]>
          getById: (id: string) => Promise<any>
          getByMeetingId: (meetingId: string) => Promise<any[]>
          // Paginated transcript fetching for lazy loading
          getByMeetingIdPaginated: (meetingId: string, options?: { limit?: number; offset?: number }) => Promise<{
            data: any[]
            total: number
            hasMore: boolean
            offset: number
            limit: number
          }>
          getCountByMeetingId: (meetingId: string) => Promise<number>
          delete: (id: string) => Promise<boolean>
          deleteByMeetingId: (meetingId: string) => Promise<number>
          searchInMeeting: (meetingId: string, query: string) => Promise<any[]>
          searchAll: (query: string, limit?: number) => Promise<any[]>
          getSearchCount: (meetingId: string, query: string) => Promise<number>
          getMatchingTranscriptIds: (meetingId: string, query: string) => Promise<string[]>
        }
        meetingNotes: {
          create: (input: any) => Promise<any>
          getById: (id: string) => Promise<any>
          getByMeetingId: (meetingId: string) => Promise<any[]>
          update: (id: string, input: any) => Promise<any>
          delete: (id: string) => Promise<boolean>
          getByType: (meetingId: string, noteType: string) => Promise<any[]>
        }
        tasks: {
          create: (input: any) => Promise<any>
          getById: (id: string) => Promise<any>
          getAll: () => Promise<any[]>
          getByMeetingId: (meetingId: string) => Promise<any[]>
          update: (id: string, input: any) => Promise<any>
          delete: (id: string) => Promise<boolean>
          getByStatus: (status: string) => Promise<any[]>
          getPending: () => Promise<any[]>
        }
        speakers: {
          create: (input: any) => Promise<any>
          getById: (id: string) => Promise<any>
          getAll: () => Promise<any[]>
          // Efficient batch fetch by IDs
          getByIds: (ids: string[]) => Promise<any[]>
          // Get speakers only for a specific meeting (more efficient than getAll)
          getByMeetingId: (meetingId: string) => Promise<any[]>
          update: (id: string, input: any) => Promise<any>
          delete: (id: string) => Promise<boolean>
          getUser: () => Promise<any>
        }
        // Meeting-specific speaker name overrides
        meetingSpeakerNames: {
          getByMeetingId: (meetingId: string) => Promise<any[]>
          setName: (meetingId: string, speakerId: string, displayName: string) => Promise<any>
          delete: (meetingId: string, speakerId: string) => Promise<boolean>
          deleteByMeetingId: (meetingId: string) => Promise<number>
        }
        settings: {
          get: <T = unknown>(key: string) => Promise<T | null>
          set: (key: string, value: unknown, category?: string) => Promise<any>
          delete: (key: string) => Promise<boolean>
          getByCategory: (category: string) => Promise<any[]>
          getAll: () => Promise<any[]>
        }
        utils: {
          backup: (path: string) => Promise<boolean>
          getStats: () => Promise<any>
          getSchemaVersion: () => Promise<number>
          getMigrationHistory: () => Promise<any[]>
        }
      }
      recording: any
      audioDevices: any
      systemAudioCapture: any
      mlPipeline: any
      liveTranscription: any
      diarization: any
      coreDiarization: any
      streamingDiarization: any
      diarizationFailure: any
      llmPostProcessing: any
      pythonValidation: any
      pythonSetup: {
        isRequired: () => Promise<boolean>
        scriptsExist: () => Promise<boolean>
        getState: () => Promise<{
          status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
          progress: number
          currentStep: string
          error?: string
          startTime?: number
          endTime?: number
        }>
        getSteps: () => Promise<Array<{
          id: string
          name: string
          description: string
          estimatedTime?: string
        }>>
        getMetadata: () => Promise<{
          schemaVersion: number
          createdAt: string
          updatedAt: string
          setupScript: string
          systemPython: {
            version: string
            path: string
          }
          environments: {
            whisperx: {
              path: string
              pythonVersion: string
              packages: Record<string, string>
              purpose: string
              status: string
            }
            pyannote: {
              path: string
              pythonVersion: string
              packages: Record<string, string>
              purpose: string
              status: string
            }
          }
          models: {
            downloaded: boolean
            hfTokenConfigured: boolean
          }
          platform: {
            os: string
            arch: string
            osVersion?: string
          }
        } | null>
        isHfTokenConfigured: () => Promise<boolean>
        getEstimatedTime: (skipModels: boolean) => Promise<string>
        getEnvironmentPaths: () => Promise<{ whisperx: string; pyannote: string }>
        runSetup: (options?: {
          skipModels?: boolean
          force?: boolean
          quiet?: boolean
          hfToken?: string
        }) => Promise<{
          success: boolean
          error?: string
          exitCode: number
          duration: number
          metadata?: any
          remediationSteps?: string[]
        }>
        cancelSetup: () => Promise<boolean>
        repair: (options?: {
          skipModels?: boolean
          quiet?: boolean
          hfToken?: string
        }) => Promise<{
          success: boolean
          error?: string
          exitCode: number
          duration: number
          metadata?: any
          remediationSteps?: string[]
        }>
        reset: () => Promise<{ success: boolean }>
        onProgress: (callback: (progress: {
          step: string
          percentage: number
          message: string
          estimatedTime?: string
          timestamp: string
          type: 'progress' | 'success' | 'error' | 'warning' | 'step_complete' | 'complete' | 'remediation'
          code?: number
          remediationSteps?: string[]
        }) => void) => () => void
        onStateChange: (callback: (state: {
          status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
          progress: number
          currentStep: string
          error?: string
          startTime?: number
          endTime?: number
        }) => void) => () => void
      }
      modelManager: any
      screenCaptureKit: any
      meetingSummary: {
        checkAvailability: () => Promise<{ available: boolean; error?: string; modelInfo?: string }>
        generateSummary: (meetingId: string, config?: any) => Promise<any>
        deleteExistingSummary: (meetingId: string) => Promise<{ success: boolean; deleted: number; error?: string }>
        getConfig: () => Promise<any>
        updateConfig: (config: any) => Promise<{ success: boolean; error?: string }>
      }
      actionItems: {
        checkAvailability: () => Promise<{ available: boolean; error?: string; modelInfo?: string }>
        extract: (meetingId: string, config?: any) => Promise<any>
        deleteExisting: (meetingId: string) => Promise<{ success: boolean; deletedNotes: number; deletedTasks: number; error?: string }>
        getConfig: () => Promise<any>
        updateConfig: (config: any) => Promise<{ success: boolean; error?: string }>
      }
      decisionsAndTopics: {
        checkAvailability: () => Promise<{ available: boolean; error?: string; modelInfo?: string }>
        extract: (meetingId: string, config?: any) => Promise<any>
        deleteExisting: (meetingId: string) => Promise<{ success: boolean; deleted: number; error?: string }>
        getConfig: () => Promise<any>
        updateConfig: (config: any) => Promise<{ success: boolean; error?: string }>
        getDecisions: (meetingId: string) => Promise<{ success: boolean; decisions: any[]; error?: string }>
        getTopicsWithDetails: (meetingId: string) => Promise<{ success: boolean; topics: any[]; error?: string }>
      }
      export: ExportAPI
      update: UpdateAPI
      shell: {
        openExternal: (url: string) => Promise<void>
        openPath: (path: string) => Promise<string>
        getFileStats: (filePath: string) => Promise<{ size: number; mtime: string; ctime: string }>
        selectDirectory: (defaultPath?: string) => Promise<string | null>
      }
      llmProvider: {
        detectProviders: (options?: {
          providers?: ('lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom')[]
          timeoutMs?: number
          parallel?: boolean
        }) => Promise<{
          providers: Array<{
            provider: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'
            available: boolean
            responseTimeMs?: number
            error?: string
            lastChecked: number
            loadedModel?: string
          }>
          recommendedPrimary?: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'
          timestamp: number
          detectionTimeMs: number
          error?: string
        }>
        getRegisteredProviders: () => Promise<('lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom')[]>
        getEnabledProviders: () => Promise<('lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom')[]>
        setDefaultProvider: (providerType: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom') => Promise<{ success: boolean; error?: string }>
        checkHealth: (forceRefresh?: boolean) => Promise<{
          success: boolean
          data?: { healthy: boolean; responseTimeMs: number; serverVersion?: string; loadedModel?: string }
          error?: string
          provider: string
          responseTimeMs?: number
        }>
        isAvailable: () => Promise<boolean>
        getConfig: () => Promise<{
          defaultProvider: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'
          fallback: {
            enabled: boolean
            maxAttempts: number
            delayBetweenAttemptsMs: number
            cacheAvailability: boolean
            availabilityCacheTtlMs: number
          }
          autoDetect: boolean
          healthCheckIntervalMs: number
        } | null>
        updateConfig: (config: { defaultProvider?: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom' }) => Promise<{ success: boolean; error?: string }>
        registerProviderByType: (
          providerType: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom',
          config?: Record<string, unknown>,
          priority?: 'primary' | 'secondary' | 'tertiary' | 'fallback',
          isDefault?: boolean
        ) => Promise<{ success: boolean; error?: string }>
      }
      llmHealthCheck: {
        getSummary: () => Promise<{
          timestamp: number
          totalProviders: number
          availableProviders: number
          unavailableProviders: number
          providers: Array<{
            provider: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'
            available: boolean
            lastChecked: number
            responseTimeMs?: number
            error?: string
            consecutiveFailures: number
            lastSuccessTime?: number
            troubleshootingGuidance?: string
          }>
          recentEvents: Array<{
            id: string
            timestamp: number
            provider: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'
            type: 'check' | 'failure' | 'recovery' | 'fallback'
            available: boolean
            responseTimeMs?: number
            error?: string
            details?: Record<string, unknown>
          }>
          hasWarnings: boolean
          warnings: string[]
        }>
        runNow: () => Promise<{
          timestamp: number
          totalProviders: number
          availableProviders: number
          unavailableProviders: number
          providers: Array<{
            provider: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'
            available: boolean
            lastChecked: number
            responseTimeMs?: number
            error?: string
            consecutiveFailures: number
            lastSuccessTime?: number
            troubleshootingGuidance?: string
          }>
          recentEvents: Array<{
            id: string
            timestamp: number
            provider: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'
            type: 'check' | 'failure' | 'recovery' | 'fallback'
            available: boolean
            responseTimeMs?: number
            error?: string
            details?: Record<string, unknown>
          }>
          hasWarnings: boolean
          warnings: string[]
        }>
        getProviderStatus: (provider: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom') => Promise<{
          provider: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'
          available: boolean
          lastChecked: number
          responseTimeMs?: number
          error?: string
          consecutiveFailures: number
          lastSuccessTime?: number
          troubleshootingGuidance?: string
        } | null>
        getEventHistory: (limit?: number) => Promise<Array<{
          id: string
          timestamp: number
          provider: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'
          type: 'check' | 'failure' | 'recovery' | 'fallback'
          available: boolean
          responseTimeMs?: number
          error?: string
          details?: Record<string, unknown>
        }>>
        getTroubleshootingGuidance: (provider: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom', error?: string) => Promise<string>
        start: (config?: {
          intervalMs?: number
          maxHistorySize?: number
          timeoutMs?: number
          autoStart?: boolean
          providers?: ('lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom')[]
        }) => Promise<{ success: boolean; error?: string }>
        stop: () => Promise<{ success: boolean; error?: string }>
        getConfig: () => Promise<{
          intervalMs: number
          maxHistorySize: number
          timeoutMs: number
          autoStart: boolean
          providers?: ('lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom')[]
        } | null>
        updateConfig: (config: {
          intervalMs?: number
          maxHistorySize?: number
          timeoutMs?: number
          autoStart?: boolean
          providers?: ('lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom')[]
        }) => Promise<{ success: boolean; error?: string }>
        isRunning: () => Promise<boolean>
        clearHistory: () => Promise<{ success: boolean; error?: string }>
        onStatusChange: (callback: (summary: {
          timestamp: number
          totalProviders: number
          availableProviders: number
          unavailableProviders: number
          providers: Array<{
            provider: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'
            available: boolean
            lastChecked: number
            responseTimeMs?: number
            error?: string
            consecutiveFailures: number
            lastSuccessTime?: number
            troubleshootingGuidance?: string
          }>
          recentEvents: Array<{
            id: string
            timestamp: number
            provider: 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'
            type: 'check' | 'failure' | 'recovery' | 'fallback'
            available: boolean
            responseTimeMs?: number
            error?: string
            details?: Record<string, unknown>
          }>
          hasWarnings: boolean
          warnings: string[]
        }) => void) => () => void
      }
      // Live Notes API (real-time meeting notes during recording)
      liveNotes: {
        checkAvailability: () => Promise<{
          available: boolean
          error?: string
          modelInfo?: string
        }>
        startSession: (
          meetingId: string,
          config?: {
            batchIntervalMs?: number
            minSegmentsPerBatch?: number
            maxSegmentsPerBatch?: number
            maxTokens?: number
            temperature?: number
            extractKeyPoints?: boolean
            extractActionItems?: boolean
            extractDecisions?: boolean
            extractTopics?: boolean
          }
        ) => Promise<{ success: boolean; error?: string; llmProvider?: string }>
        stopSession: () => Promise<{
          success: boolean
          totalNotes: number
          batchesProcessed: number
        }>
        pauseSession: () => Promise<{ success: boolean }>
        resumeSession: () => Promise<{ success: boolean }>
        addSegments: (segments: Array<{
          id: string
          content: string
          speaker?: string | null
          start_time_ms: number
          end_time_ms: number
        }>) => Promise<{ success: boolean }>
        getSessionState: () => Promise<{
          isActive: boolean
          meetingId: string | null
          pendingSegments: number
          processedSegments: number
          batchesProcessed: number
          totalNotesGenerated: number
        }>
        getConfig: () => Promise<{
          batchIntervalMs?: number
          minSegmentsPerBatch?: number
          maxSegmentsPerBatch?: number
          maxTokens?: number
          temperature?: number
          extractKeyPoints?: boolean
          extractActionItems?: boolean
          extractDecisions?: boolean
          extractTopics?: boolean
        }>
        updateConfig: (config: {
          batchIntervalMs?: number
          minSegmentsPerBatch?: number
          maxSegmentsPerBatch?: number
          maxTokens?: number
          temperature?: number
          extractKeyPoints?: boolean
          extractActionItems?: boolean
          extractDecisions?: boolean
          extractTopics?: boolean
        }) => Promise<{ success: boolean }>
        forceBatchProcess: () => Promise<{ success: boolean }>
        onNotes: (callback: (notes: Array<{
          id: string
          type: 'key_point' | 'action_item' | 'decision' | 'topic'
          content: string
          speaker?: string | null
          priority?: 'high' | 'medium' | 'low'
          assignee?: string | null
          extractedAt: number
          sourceSegmentIds: string[]
          isPreliminary: boolean
          confidence?: number
        }>) => void) => () => void
        onStatus: (callback: (status: { status: string; timestamp: number }) => void) => () => void
        onBatchState: (callback: (state: Record<string, unknown>) => void) => () => void
        onError: (callback: (error: {
          code: string
          message: string
          timestamp: number
          recoverable: boolean
        }) => void) => () => void
        onNotesPersisted: (callback: (data: {
          meetingId: string
          notesCount: number
          tasksCount: number
          timestamp: number
        }) => void) => () => void
        onSaveProgress: (callback: (data: {
          meetingId: string
          total: number
          saved: number
          currentType: 'notes' | 'tasks'
          completed?: boolean
          errors?: string[]
          timestamp: number
        }) => void) => () => void
      }
      // Transcript Correction API (AI-assisted transcription correction)
      transcriptCorrection: any
      // Confidence Scoring API (transcription quality metrics)
      confidenceScoring: {
        getConfidenceLevel: (confidence: number) => Promise<'high' | 'medium' | 'low'>
        getSegmentConfidenceInfo: (transcriptId: string) => Promise<{
          transcriptId: string
          confidence: number
          level: 'high' | 'medium' | 'low'
          needsReview: boolean
          percentageDisplay: string
          colorClass: string
          badgeClass: string
          hasBeenCorrected: boolean
          hasBeenAdjusted: boolean
        } | null>
        calculateMeetingMetrics: (meetingId: string) => Promise<{
          id: string
          meeting_id: string
          overall_score: number
          high_confidence_count: number
          medium_confidence_count: number
          low_confidence_count: number
          total_segments: number
          average_word_confidence: number
          min_confidence: number
          max_confidence: number
          needs_review_count: number
          auto_corrected_count: number
          manual_adjustment_count: number
          created_at: string
          updated_at: string
        } | null>
        getMetrics: (meetingId: string) => Promise<{
          id: string
          meeting_id: string
          overall_score: number
          high_confidence_count: number
          medium_confidence_count: number
          low_confidence_count: number
          total_segments: number
          average_word_confidence: number
          min_confidence: number
          max_confidence: number
          needs_review_count: number
          auto_corrected_count: number
          manual_adjustment_count: number
          created_at: string
          updated_at: string
        } | null>
        getMeetingConfidenceSummary: (meetingId: string) => Promise<{
          meetingId: string
          overallScore: number
          overallLevel: 'high' | 'medium' | 'low'
          highConfidencePercent: number
          mediumConfidencePercent: number
          lowConfidencePercent: number
          totalSegments: number
          needsReviewCount: number
          qualityDescription: string
          trend: 'improving' | 'stable' | 'degrading' | 'unknown'
        } | null>
        recordTrendDataPoint: (
          meetingId: string,
          timestampMs: number,
          windowConfidence: number,
          segmentCount: number
        ) => Promise<{
          type: 'low_confidence' | 'degrading_quality' | 'audio_issue'
          message: string
          severity: 'warning' | 'error'
          timestampMs: number
          windowConfidence: number
          suggestedAction: string
        } | null>
        getTrends: (meetingId: string) => Promise<Array<{
          id: string
          meeting_id: string
          timestamp_ms: number
          window_confidence: number
          segment_count: number
          is_alert_triggered: boolean
          alert_type: string | null
          created_at: string
        }>>
        getAlerts: (meetingId: string) => Promise<Array<{
          id: string
          meeting_id: string
          timestamp_ms: number
          window_confidence: number
          segment_count: number
          is_alert_triggered: boolean
          alert_type: string | null
          created_at: string
        }>>
        getLowConfidenceTranscripts: (meetingId: string, threshold?: number) => Promise<any[]>
        getTranscriptsNeedingReview: (meetingId: string) => Promise<any[]>
        triggerBatchAutoCorrection: (meetingId: string) => Promise<{
          triggered: number
          skipped: number
          errors: string[]
        }>
        adjustConfidence: (
          transcriptId: string,
          newConfidence: number,
          reason?: string
        ) => Promise<{
          id: string
          transcript_id: string
          meeting_id: string
          original_confidence: number
          adjusted_confidence: number
          reason: string | null
          created_at: string
        } | null>
        getAdjustmentHistory: (transcriptId: string) => Promise<Array<{
          id: string
          transcript_id: string
          meeting_id: string
          original_confidence: number
          adjusted_confidence: number
          reason: string | null
          created_at: string
        }>>
        getMeetingAdjustments: (meetingId: string) => Promise<Array<{
          id: string
          transcript_id: string
          meeting_id: string
          original_confidence: number
          adjusted_confidence: number
          reason: string | null
          created_at: string
        }>>
        processLiveSegment: (transcriptId: string) => Promise<{
          info: {
            transcriptId: string
            confidence: number
            level: 'high' | 'medium' | 'low'
            needsReview: boolean
            percentageDisplay: string
            colorClass: string
            badgeClass: string
            hasBeenCorrected: boolean
            hasBeenAdjusted: boolean
          }
          alert: {
            type: 'low_confidence' | 'degrading_quality' | 'audio_issue'
            message: string
            severity: 'warning' | 'error'
            timestampMs: number
            windowConfidence: number
            suggestedAction: string
          } | null
          shouldAutoCorrect: boolean
        } | null>
        resetAlertState: (meetingId: string) => Promise<{ success: boolean }>
        updateConfig: (config: Partial<{
          thresholds: { high: number; medium: number; low: number }
          alertThreshold: number
          alertWindowMs: number
          alertConsecutiveCount: number
          autoCorrectThreshold: number
          reviewThreshold: number
          trendSampleIntervalMs: number
        }>) => Promise<{ success: boolean }>
        getConfig: () => Promise<{
          thresholds: { high: number; medium: number; low: number }
          alertThreshold: number
          alertWindowMs: number
          alertConsecutiveCount: number
          autoCorrectThreshold: number
          reviewThreshold: number
          trendSampleIntervalMs: number
        }>
        getThresholds: () => Promise<{ high: number; medium: number; low: number }>
        deleteByMeetingId: (meetingId: string) => Promise<{ success: boolean }>
      }
    }
  }
}

export {}
