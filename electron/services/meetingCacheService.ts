/**
 * Meeting Cache Service
 *
 * Wraps the meeting service with caching functionality using the Redis cache.
 * Implements stale-while-revalidate pattern:
 * - Returns cached data instantly (even if stale)
 * - Always fetches fresh data in background
 * - Updates cache when fresh data arrives
 */

import { redisCacheService } from './redisCacheService'
import { meetingService } from './meetingService'
import type { Meeting, MeetingStatus, CreateMeetingInput, UpdateMeetingInput } from '../../src/types/database'
import { loggerService } from './loggerService'
import { getDatabaseService } from './database'

// Cache key constants
const CACHE_KEYS = {
  ALL: 'meetings:all',
  RECENT: (limit: number) => `meetings:recent:${limit}`,
  BY_ID: (id: string) => `meetings:id:${id}`,
  BY_STATUS: (status: MeetingStatus) => `meetings:status:${status}`
}

// Default TTL for meetings cache (5 minutes)
const MEETINGS_TTL = 300

// Track if a background refresh is already in progress to prevent concurrent refreshes
let isRefreshingInBackground = false
// Minimum time between background refreshes (in milliseconds)
const MIN_REFRESH_INTERVAL_MS = 5000
let lastRefreshTime = 0

export const meetingCacheService = {
  /**
   * Get all meetings with caching
   * Uses stale-while-revalidate pattern:
   * - Returns cached data immediately
   * - Fetches fresh data in background
   * - Updates cache when fresh data arrives
   */
  async getAll(): Promise<Meeting[]> {
    const cacheKey = CACHE_KEYS.ALL

    // Try to get from cache first (instant response)
    const cachedData = await redisCacheService.get<Meeting[]>(cacheKey)
    if (cachedData) {
      loggerService.debug('[MeetingCache] Cache hit for getAll')

      // Start background refresh (fire and forget)
      this.refreshAllInBackground()

      return cachedData
    }

    // Cache miss - fetch fresh data
    loggerService.debug('[MeetingCache] Cache miss for getAll, fetching from database')
    const freshData = meetingService.getAll()

    // Cache the fresh data
    await redisCacheService.set<Meeting[]>(cacheKey, freshData, MEETINGS_TTL)

    return freshData
  },

  /**
   * Get a meeting by ID with caching
   */
  async getById(id: string): Promise<Meeting | null> {
    const cacheKey = CACHE_KEYS.BY_ID(id)

    // Try cache first
    const cachedData = await redisCacheService.get<Meeting | null>(cacheKey)
    if (cachedData !== null) {
      loggerService.debug(`[MeetingCache] Cache hit for getById(${id})`)
      return cachedData
    }

    // Cache miss - fetch from database
    const freshData = meetingService.getById(id)

    // Cache the result (even if null)
    if (freshData) {
      await redisCacheService.set<Meeting>(cacheKey, freshData, MEETINGS_TTL)
    }

    return freshData
  },

  /**
   * Get recent meetings with caching
   */
  async getRecent(limit: number = 10): Promise<Meeting[]> {
    const cacheKey = CACHE_KEYS.RECENT(limit)

    // Try cache first
    const cachedData = await redisCacheService.get<Meeting[]>(cacheKey)
    if (cachedData) {
      loggerService.debug(`[MeetingCache] Cache hit for getRecent(${limit})`)
      return cachedData
    }

    // Cache miss - fetch from database
    const freshData = meetingService.getRecent(limit)

    // Cache the result
    await redisCacheService.set<Meeting[]>(cacheKey, freshData, MEETINGS_TTL)

    return freshData
  },

  /**
   * Get meetings by status with caching
   */
  async getByStatus(status: MeetingStatus): Promise<Meeting[]> {
    const cacheKey = CACHE_KEYS.BY_STATUS(status)

    // Try cache first
    const cachedData = await redisCacheService.get<Meeting[]>(cacheKey)
    if (cachedData) {
      loggerService.debug(`[MeetingCache] Cache hit for getByStatus(${status})`)
      return cachedData
    }

    // Cache miss - fetch from database
    const freshData = meetingService.getByStatus(status)

    // Cache the result
    await redisCacheService.set<Meeting[]>(cacheKey, freshData, MEETINGS_TTL)

    return freshData
  },

  /**
   * Create a meeting and invalidate cache
   */
  async create(input: CreateMeetingInput): Promise<Meeting> {
    const meeting = meetingService.create(input)

    // Invalidate the meetings list cache
    await this.invalidateListCache()

    loggerService.debug(`[MeetingCache] Invalidated cache after creating meeting ${meeting.id}`)

    return meeting
  },

  /**
   * Update a meeting and invalidate cache
   */
  async update(id: string, input: UpdateMeetingInput): Promise<Meeting | null> {
    const updated = meetingService.update(id, input)

    if (updated) {
      // Invalidate specific meeting cache and list cache
      await redisCacheService.delete(CACHE_KEYS.BY_ID(id))
      await this.invalidateListCache()

      loggerService.debug(`[MeetingCache] Invalidated cache after updating meeting ${id}`)
    }

    return updated
  },

  /**
   * Delete a meeting and invalidate cache
   */
  async delete(id: string): Promise<boolean> {
    const deleted = meetingService.delete(id)

    if (deleted) {
      // Invalidate specific meeting cache and list cache
      await redisCacheService.delete(CACHE_KEYS.BY_ID(id))
      await this.invalidateListCache()

      loggerService.debug(`[MeetingCache] Invalidated cache after deleting meeting ${id}`)
    }

    return deleted
  },

  /**
   * Invalidate all cache related to meetings
   */
  async invalidateCache(): Promise<void> {
    await this.invalidateListCache()

    // Also try to invalidate common status caches
    const statuses: MeetingStatus[] = ['completed', 'in_progress', 'scheduled', 'cancelled']
    for (const status of statuses) {
      await redisCacheService.delete(CACHE_KEYS.BY_STATUS(status))
    }

    // Invalidate recent meetings caches
    for (let i = 5; i <= 50; i += 5) {
      await redisCacheService.delete(CACHE_KEYS.RECENT(i))
    }

    loggerService.info('[MeetingCache] Invalidated all meetings cache')
  },

  /**
   * Invalidate the main meetings list cache
   */
  invalidateListCache: async (): Promise<void> => {
    await redisCacheService.delete(CACHE_KEYS.ALL)
  },

  /**
   * Refresh the all meetings cache in the background
   * This is called after returning cached data to keep it fresh
   * Includes debouncing to prevent excessive refreshes
   */
  refreshAllInBackground: (): void => {
    // Check if database is initialized before attempting refresh
    // This prevents errors during app startup when cache may have data but DB isn't ready
    if (!getDatabaseService().isInitialized()) {
      loggerService.debug('[MeetingCache] Skipping background refresh - database not initialized')
      return
    }

    // Prevent concurrent background refreshes
    if (isRefreshingInBackground) {
      loggerService.debug('[MeetingCache] Skipping background refresh - already in progress')
      return
    }

    // Throttle refreshes to prevent excessive calls
    const now = Date.now()
    if (now - lastRefreshTime < MIN_REFRESH_INTERVAL_MS) {
      loggerService.debug('[MeetingCache] Skipping background refresh - too soon since last refresh')
      return
    }

    isRefreshingInBackground = true
    lastRefreshTime = now

    // Use setImmediate to run after current operation completes
    setImmediate(async () => {
      try {
        // Double-check database is still initialized (could have been closed during setImmediate)
        if (!getDatabaseService().isInitialized()) {
          loggerService.debug('[MeetingCache] Skipping background refresh - database closed')
          return
        }
        const freshData = meetingService.getAll()
        await redisCacheService.set<Meeting[]>(CACHE_KEYS.ALL, freshData, MEETINGS_TTL)
        loggerService.debug('[MeetingCache] Background refresh completed for getAll')
      } catch (error) {
        loggerService.warn('[MeetingCache] Background refresh failed', { error })
        // Don't throw - background refresh failure shouldn't affect the app
      } finally {
        isRefreshingInBackground = false
      }
    })
  },

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats() {
    return redisCacheService.getStats()
  }
}
