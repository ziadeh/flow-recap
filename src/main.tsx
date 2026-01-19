import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeProvider } from './components/ThemeProvider'
import './index.css'

// ============================================================================
// Chunk Preloading Strategy
// ============================================================================
// Preload service chunks in the background during app startup to reduce
// perceived latency when users access features.
//
// This uses requestIdleCallback to avoid blocking the main UI thread:
// 1. Recording chunk - preload after dashboard renders (user might record)
// 2. AI/Insights chunk - preload after meeting detail loads (user might generate insights)
// 3. Diarization chunk - preload last (lowest priority)
// ============================================================================

/**
 * Preload an async chunk in the background without blocking UI
 * @param chunkName - The name of the chunk to preload (from Vite build output)
 */
function preloadChunk(chunkName: string): void {
  // Use requestIdleCallback if available (most modern browsers)
  const scheduleLoad = (typeof requestIdleCallback !== 'undefined')
    ? requestIdleCallback
    : (callback: IdleRequestCallback) => setTimeout(callback as any, 100)

  scheduleLoad(() => {
    // Create a link element to preload the chunk
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.as = 'script'
    link.href = `/dist/${chunkName}.js` // Adjust path based on your build output
    link.onerror = () => {
      console.warn(`[Chunk Preloader] Failed to preload chunk: ${chunkName}`)
    }
    document.head.appendChild(link)
    console.log(`[Chunk Preloader] Preloading chunk: ${chunkName}`)
  })
}

/**
 * Preload recording chunk after app initializes
 * Users are most likely to start recording from the dashboard
 */
function preloadRecordingChunk(): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(
      () => {
        console.log('[Chunk Preloader] Scheduling recording chunk preload...')
        preloadChunk('recording-services')
      },
      { timeout: 2000 } // Preload within 2 seconds of app startup
    )
  }
}

/**
 * Preload AI insights chunk after recording chunk
 * Users access insights after recording completes
 */
function preloadAIInsightsChunk(): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(
      () => {
        console.log('[Chunk Preloader] Scheduling AI insights chunk preload...')
        preloadChunk('ai-insights-services')
      },
      { timeout: 4000 } // Preload within 4 seconds of app startup
    )
  }
}

/**
 * Preload diarization chunk (lowest priority)
 */
function preloadDiarizationChunk(): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(
      () => {
        console.log('[Chunk Preloader] Scheduling diarization chunk preload...')
        preloadChunk('diarization-services')
      },
      { timeout: 6000 } // Preload within 6 seconds of app startup
    )
  }
}

// Preload chunks after a short delay to let the app render first
setTimeout(() => {
  preloadRecordingChunk()
  preloadAIInsightsChunk()
  preloadDiarizationChunk()
}, 500)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
