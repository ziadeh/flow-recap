/**
 * Redis Cache Service
 *
 * Provides an in-memory caching service for LLM responses and other data.
 * This service mimics a Redis-like interface but operates entirely in-memory,
 * which is suitable for Electron desktop applications where a distributed
 * cache server is not typically available.
 *
 * Features:
 * - TTL-based cache expiration
 * - Configurable TTL values per cache category
 * - Cache statistics and monitoring
 * - Memory-efficient cleanup of expired entries
 *
 * Note: For production distributed systems, this could be replaced with
 * actual Redis using ioredis or similar client.
 */

import { loggerService } from './loggerService'

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the Redis cache service
 */
export interface RedisCacheConfig {
  /** Default TTL in seconds for cache entries */
  defaultTTL: number
  /** Maximum number of entries to store (0 = unlimited) */
  maxEntries: number
  /** Whether to enable cache statistics collection */
  enableStats: boolean
  /** TTL values for specific cache categories (in seconds) */
  categoryTTLs: Record<string, number>
}

/**
 * Statistics about cache usage
 */
export interface CacheStats {
  /** Total number of entries in cache */
  entries: number
  /** Number of cache hits */
  hits: number
  /** Number of cache misses */
  misses: number
  /** Hit rate as a percentage */
  hitRate: number
  /** Total memory used (approximate) */
  memoryUsageBytes: number
  /** Number of expired entries cleaned up */
  expiredCleaned: number
}

/**
 * Internal cache entry structure
 */
interface CacheEntry<T = unknown> {
  /** The cached value */
  value: T
  /** Expiration timestamp (Date.now() + TTL * 1000) */
  expiresAt: number
  /** When the entry was created */
  createdAt: number
  /** Size of the entry in bytes (approximate) */
  sizeBytes: number
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: RedisCacheConfig = {
  defaultTTL: 3600, // 1 hour
  maxEntries: 10000,
  enableStats: true,
  categoryTTLs: {
    llmResponse: 86400, // 24 hours for LLM responses (expensive to regenerate)
    transcript: 3600, // 1 hour for transcript data
    summary: 7200, // 2 hours for meeting summaries
    model: 300, // 5 minutes for model info
    health: 60, // 1 minute for health checks
  },
}

// ============================================================================
// Redis Cache Service Class
// ============================================================================

class RedisCacheService {
  private cache: Map<string, CacheEntry> = new Map()
  private config: RedisCacheConfig
  private stats: CacheStats = {
    entries: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    memoryUsageBytes: 0,
    expiredCleaned: 0,
  }
  private cleanupInterval: NodeJS.Timeout | null = null
  private initialized: boolean = false

  constructor(config?: Partial<RedisCacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Initialize the cache service
   * Starts the periodic cleanup timer
   */
  initialize(config?: Partial<RedisCacheConfig>): void {
    if (this.initialized) {
      loggerService.warn('[RedisCache] Service already initialized')
      return
    }

    if (config) {
      this.config = { ...this.config, ...config }
    }

    // Start periodic cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired()
    }, 5 * 60 * 1000)

    this.initialized = true
    loggerService.info('[RedisCache] Cache service initialized', {
      defaultTTL: this.config.defaultTTL,
      maxEntries: this.config.maxEntries,
    })
  }

  /**
   * Cleanup the cache service
   * Stops the cleanup timer and clears all entries
   */
  cleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    this.cache.clear()
    this.resetStats()
    this.initialized = false
    loggerService.info('[RedisCache] Cache service cleaned up')
  }

  /**
   * Get a value from the cache
   *
   * @param key - The cache key
   * @returns The cached value or null if not found/expired
   */
  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key)

    if (!entry) {
      this.recordMiss()
      return null
    }

    // Check if entry has expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.updateEntriesCount()
      this.recordMiss()
      return null
    }

    this.recordHit()
    return entry.value as T
  }

  /**
   * Set a value in the cache
   *
   * @param key - The cache key
   * @param value - The value to cache
   * @param ttl - TTL in seconds (uses default if not specified)
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const effectiveTTL = ttl ?? this.config.defaultTTL
    const now = Date.now()
    const sizeBytes = this.estimateSize(value)

    // Check max entries limit
    if (this.config.maxEntries > 0 && this.cache.size >= this.config.maxEntries) {
      // Evict oldest entries
      this.evictOldest(Math.ceil(this.config.maxEntries * 0.1)) // Evict 10%
    }

    const entry: CacheEntry<T> = {
      value,
      expiresAt: now + effectiveTTL * 1000,
      createdAt: now,
      sizeBytes,
    }

    this.cache.set(key, entry)
    this.updateEntriesCount()
    this.stats.memoryUsageBytes += sizeBytes
  }

  /**
   * Delete a value from the cache
   *
   * @param key - The cache key to delete
   * @returns true if the key was deleted, false if it didn't exist
   */
  async delete(key: string): Promise<boolean> {
    const entry = this.cache.get(key)
    if (entry) {
      this.stats.memoryUsageBytes -= entry.sizeBytes
      this.cache.delete(key)
      this.updateEntriesCount()
      return true
    }
    return false
  }

  /**
   * Check if a key exists in the cache (and is not expired)
   *
   * @param key - The cache key to check
   * @returns true if the key exists and is not expired
   */
  async exists(key: string): Promise<boolean> {
    const entry = this.cache.get(key)
    if (!entry) return false

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.updateEntriesCount()
      return false
    }

    return true
  }

  /**
   * Get the TTL for a specific cache category
   *
   * @param category - The cache category (e.g., 'llmResponse', 'transcript')
   * @returns TTL in seconds
   */
  getTTL(category: string): number {
    return this.config.categoryTTLs[category] ?? this.config.defaultTTL
  }

  /**
   * Set the TTL for a specific cache category
   *
   * @param category - The cache category
   * @param ttl - TTL in seconds
   */
  setTTL(category: string, ttl: number): void {
    this.config.categoryTTLs[category] = ttl
  }

  /**
   * Get the remaining TTL for a cached key
   *
   * @param key - The cache key
   * @returns Remaining TTL in seconds, or -1 if key doesn't exist
   */
  async ttl(key: string): Promise<number> {
    const entry = this.cache.get(key)
    if (!entry) return -1

    const remaining = Math.floor((entry.expiresAt - Date.now()) / 1000)
    return remaining > 0 ? remaining : -1
  }

  /**
   * Clear all entries from the cache
   */
  async clear(): Promise<void> {
    this.cache.clear()
    this.stats.memoryUsageBytes = 0
    this.updateEntriesCount()
    loggerService.info('[RedisCache] Cache cleared')
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats }
  }

  /**
   * Get the current configuration
   */
  getConfig(): RedisCacheConfig {
    return { ...this.config }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RedisCacheConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get all keys matching a pattern (simple glob support)
   *
   * @param pattern - Pattern to match (supports * wildcard)
   * @returns Array of matching keys
   */
  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
    const matchingKeys: string[] = []
    const now = Date.now()

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
        this.stats.expiredCleaned++
      } else if (regex.test(key)) {
        matchingKeys.push(key)
      }
    }

    this.updateEntriesCount()
    return matchingKeys
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Clean up expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now()
    let cleaned = 0

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.stats.memoryUsageBytes -= entry.sizeBytes
        this.cache.delete(key)
        cleaned++
      }
    }

    if (cleaned > 0) {
      this.stats.expiredCleaned += cleaned
      this.updateEntriesCount()
      loggerService.info(`[RedisCache] Cleaned up ${cleaned} expired entries`)
    }
  }

  /**
   * Evict oldest entries to make room for new ones
   */
  private evictOldest(count: number): void {
    const entries = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].createdAt - b[1].createdAt
    )

    for (let i = 0; i < Math.min(count, entries.length); i++) {
      const [key, entry] = entries[i]
      this.stats.memoryUsageBytes -= entry.sizeBytes
      this.cache.delete(key)
    }

    this.updateEntriesCount()
    loggerService.info(`[RedisCache] Evicted ${count} oldest entries`)
  }

  /**
   * Estimate the size of a value in bytes
   */
  private estimateSize(value: unknown): number {
    try {
      const json = JSON.stringify(value)
      return json.length * 2 // Approximate UTF-16 encoding
    } catch {
      return 1024 // Default estimate for non-serializable objects
    }
  }

  /**
   * Record a cache hit
   */
  private recordHit(): void {
    if (this.config.enableStats) {
      this.stats.hits++
      this.updateHitRate()
    }
  }

  /**
   * Record a cache miss
   */
  private recordMiss(): void {
    if (this.config.enableStats) {
      this.stats.misses++
      this.updateHitRate()
    }
  }

  /**
   * Update the hit rate calculation
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0
  }

  /**
   * Update the entries count in stats
   */
  private updateEntriesCount(): void {
    this.stats.entries = this.cache.size
  }

  /**
   * Reset statistics
   */
  private resetStats(): void {
    this.stats = {
      entries: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      memoryUsageBytes: 0,
      expiredCleaned: 0,
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const redisCacheService = new RedisCacheService()

/**
 * Initialize the Redis cache service
 * Call this during application startup
 */
export function initializeRedisCache(config?: Partial<RedisCacheConfig>): void {
  redisCacheService.initialize(config)
}

/**
 * Cleanup the Redis cache service
 * Call this during application shutdown
 */
export function cleanupRedisCache(): void {
  redisCacheService.cleanup()
}

// Export class for testing
export { RedisCacheService }
