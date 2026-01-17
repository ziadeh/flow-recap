/**
 * Insights Analytics Utility
 *
 * Provides event tracking for the Insights tab feature.
 * Events are logged to console in development and can be extended
 * to use an analytics provider in production.
 *
 * Events tracked:
 * - insights_tab_viewed: User opens the Insights tab
 * - action_item_completed: User completes an action item
 * - action_item_uncompleted: User uncompletes an action item
 * - decision_edited: User edits a decision
 * - insight_generated: AI generates new insights
 * - insight_regenerated: User regenerates insights
 * - insights_exported: User exports insights
 * - insight_section_expanded: User expands a section
 * - insight_section_collapsed: User collapses a section
 * - time_on_insights_tab: Total time spent on Insights tab (on unmount)
 */

export interface InsightsAnalyticsEvent {
  event: string
  timestamp: number
  properties?: Record<string, unknown>
}

export type InsightsEventName =
  | 'insights_tab_viewed'
  | 'insights_tab_exited'
  | 'action_item_completed'
  | 'action_item_uncompleted'
  | 'decision_edited'
  | 'decision_added'
  | 'key_point_added'
  | 'insight_generated'
  | 'insight_regenerated'
  | 'insights_exported'
  | 'insight_section_expanded'
  | 'insight_section_collapsed'
  | 'time_on_insights_tab'
  | 'generate_insights_clicked'
  | 'retry_fetch_clicked'

interface InsightsAnalyticsConfig {
  /** Whether to enable console logging in development */
  enableConsoleLogging?: boolean
  /** Custom event handler for production analytics */
  onEvent?: (event: InsightsAnalyticsEvent) => void
}

let analyticsConfig: InsightsAnalyticsConfig = {
  enableConsoleLogging: process.env.NODE_ENV === 'development',
}

/**
 * Configure the insights analytics utility
 */
export function configureInsightsAnalytics(config: InsightsAnalyticsConfig): void {
  analyticsConfig = { ...analyticsConfig, ...config }
}

/**
 * Track an insights-related event
 */
export function trackInsightsEvent(
  eventName: InsightsEventName,
  properties?: Record<string, unknown>
): void {
  const event: InsightsAnalyticsEvent = {
    event: eventName,
    timestamp: Date.now(),
    properties,
  }

  // Log to console in development
  if (analyticsConfig.enableConsoleLogging) {
    console.log('[InsightsAnalytics]', eventName, properties || '')
  }

  // Call custom handler if provided
  analyticsConfig.onEvent?.(event)

  // Store in session for potential batch sending
  storeEventInSession(event)
}

/**
 * Session storage for events (for batch processing if needed)
 */
const SESSION_STORAGE_KEY = 'insights_analytics_events'
const MAX_STORED_EVENTS = 100

function storeEventInSession(event: InsightsAnalyticsEvent): void {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY)
    const events: InsightsAnalyticsEvent[] = stored ? JSON.parse(stored) : []

    events.push(event)

    // Keep only the last MAX_STORED_EVENTS
    if (events.length > MAX_STORED_EVENTS) {
      events.splice(0, events.length - MAX_STORED_EVENTS)
    }

    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(events))
  } catch (err) {
    // Silently fail if session storage is not available
    if (analyticsConfig.enableConsoleLogging) {
      console.warn('[InsightsAnalytics] Failed to store event:', err)
    }
  }
}

/**
 * Get all stored analytics events from the session
 */
export function getStoredInsightsEvents(): InsightsAnalyticsEvent[] {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

/**
 * Clear stored analytics events
 */
export function clearStoredInsightsEvents(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Silently fail
  }
}

/**
 * Create a timer for tracking time spent on a feature
 */
export function createTimeTracker(): {
  stop: () => number
  getElapsed: () => number
} {
  const startTime = Date.now()

  return {
    stop: () => {
      const elapsed = Date.now() - startTime
      return elapsed
    },
    getElapsed: () => {
      return Date.now() - startTime
    },
  }
}

/**
 * React hook for tracking insights tab view time
 */
export function useInsightsTabTimeTracking(
  _meetingId: string,
  _isActive: boolean
): void {
  // This would typically be implemented as a React hook
  // For now, the logic is documented for implementation in the component
}

// Default export for convenience
export default {
  track: trackInsightsEvent,
  configure: configureInsightsAnalytics,
  getStoredEvents: getStoredInsightsEvents,
  clearEvents: clearStoredInsightsEvents,
  createTimeTracker,
}
