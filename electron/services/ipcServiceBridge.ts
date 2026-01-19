/**
 * IPC Service Bridge
 *
 * This module provides a compatibility layer between IPC handlers and lazy-loaded services.
 * It allows existing IPC handlers to transparently use lazy-loaded service modules
 * without requiring code changes.
 *
 * Usage: Call ensureServiceLoaded() before using any service in an IPC handler
 */

import { getService, type ServiceName } from './serviceLoader'

// Map of service names to loader functions
const serviceLoaderMap: Record<string, () => Promise<any>> = {
  liveTranscriptionService: () => getService('liveTranscriptionService'),
  audioRecorderService: () => getService('audioRecorderService'),
  systemAudioCaptureService: () => getService('systemAudioCaptureService'),
  screenCaptureKitService: () => getService('screenCaptureKitService'),
  meetingSummaryService: () => getService('meetingSummaryService'),
  actionItemsService: () => getService('actionItemsService'),
  decisionsAndTopicsService: () => getService('decisionsAndTopicsService'),
  unifiedInsightsService: () => getService('unifiedInsightsService'),
  orchestratedInsightsService: () => getService('orchestratedInsightsService'),
  liveNoteGenerationService: () => getService('liveNoteGenerationService'),
  subjectAwareNoteGenerationService: () => getService('subjectAwareNoteGenerationService'),
  speakerDiarizationService: () => getService('speakerDiarizationService'),
  batchDiarizationService: () => getService('batchDiarizationService'),
  coreDiarizationService: () => getService('coreDiarizationService'),
  streamingDiarizationService: () => getService('streamingDiarizationService'),
  diarizationFailureService: () => getService('diarizationFailureService'),
  llmPostProcessingService: () => getService('llmPostProcessingService'),
}

/**
 * Ensure a service is loaded and ready before use
 * @param serviceName - The name of the service to ensure is loaded
 * @throws Error if the service name is not recognized
 */
export async function ensureServiceLoaded(serviceName: string): Promise<void> {
  const loader = serviceLoaderMap[serviceName]
  if (loader) {
    await loader()
  }
  // For core services, no action needed - they're always loaded
}

/**
 * Preload a service chunk in the background without blocking
 * Use this in the app startup to reduce perceived delay when features are accessed
 * @param serviceName - The service name or category to preload
 */
export function preloadService(serviceName: string | 'recording' | 'aiInsights' | 'diarization'): void {
  if (serviceName === 'recording' || serviceName === 'aiInsights' || serviceName === 'diarization') {
    // Preload the entire category
    const { preloadServiceChunk } = require('./serviceLoader')
    preloadServiceChunk(serviceName).catch((err: any) => {
      console.warn(`[IPC Service Bridge] Failed to preload ${serviceName}:`, err)
    })
  } else {
    // Preload a specific service
    const loader = serviceLoaderMap[serviceName]
    if (loader) {
      loader().catch((err: any) => {
        console.warn(`[IPC Service Bridge] Failed to preload ${serviceName}:`, err)
      })
    }
  }
}

/**
 * Create an IPC handler wrapper that ensures services are loaded before execution
 * @param handler - The IPC handler function
 * @param serviceNames - Array of service names needed by this handler
 * @returns A wrapped handler function that loads services before calling the original handler
 */
export function withServiceLoader<T extends (...args: any[]) => any>(
  handler: T,
  serviceNames: string[] = []
): T {
  return (async (...args: any[]) => {
    // Load all required services in parallel
    await Promise.all(serviceNames.map((name) => ensureServiceLoaded(name)))
    // Call the original handler
    return handler(...args)
  }) as T
}

/**
 * Recording IPC handlers - these need the recording module
 */
export const recordingIpcServices = {
  ensureRecordingLoaded: () => ensureServiceLoaded('liveTranscriptionService'),
  preloadRecording: () => preloadService('recording'),
}

/**
 * AI/Insights IPC handlers - these need the AI module
 */
export const aiInsightsIpcServices = {
  ensureInsightsLoaded: () => Promise.all([
    ensureServiceLoaded('meetingSummaryService'),
    ensureServiceLoaded('actionItemsService'),
    ensureServiceLoaded('decisionsAndTopicsService'),
    ensureServiceLoaded('unifiedInsightsService'),
  ]),
  preloadInsights: () => preloadService('aiInsights'),
}

/**
 * Diarization IPC handlers - these need the diarization module
 */
export const diarizationIpcServices = {
  ensureDiarizationLoaded: () => Promise.all([
    ensureServiceLoaded('speakerDiarizationService'),
    ensureServiceLoaded('coreDiarizationService'),
    ensureServiceLoaded('streamingDiarizationService'),
  ]),
  preloadDiarization: () => preloadService('diarization'),
}
