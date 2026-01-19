/**
 * Prepared Statement Cache Manager
 *
 * This module provides centralized management of prepared SQL statements
 * across all database services. Instead of each service maintaining its own cache,
 * all services use this unified cache which provides:
 *
 * - Statement reuse: Compiled SQL statements are cached and reused
 * - Performance tracking: Metrics on cache hits, misses, and memory usage
 * - Memory management: Prevents unbounded cache growth
 * - Easy debugging: Can introspect which statements are most frequently used
 *
 * Benefits:
 * - Eliminates SQL compilation overhead for frequently used queries
 * - Reduces memory usage by deduplicating identical prepared statements
 * - Provides visibility into query patterns for optimization opportunities
 */

import type BetterSqlite3 from 'better-sqlite3'
import { getDatabaseService } from './database'

interface CacheEntry {
  statement: BetterSqlite3.Statement
  sql: string
  hits: number
  lastUsed: number
  createdAt: number
  estimatedMemoryBytes: number
}

interface CacheStatistics {
  totalStatements: number
  totalHits: number
  totalMisses: number
  cacheHitRate: number
  estimatedMemoryBytes: number
  topStatements: Array<{
    sql: string
    hits: number
    memory: number
  }>
}

class StatementCache {
  private static instance: StatementCache | null = null
  private cache: Map<string, CacheEntry> = new Map()
  private totalHits: number = 0
  private totalMisses: number = 0
  private readonly maxCacheSize: number = 500 // Max statements in cache
  private readonly maxMemory: number = 100 * 1024 * 1024 // 100MB max cache memory

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): StatementCache {
    if (!StatementCache.instance) {
      StatementCache.instance = new StatementCache()
    }
    return StatementCache.instance
  }

  /**
   * Get or create a prepared statement
   * This is the main method used by all database services
   */
  get(sql: string): BetterSqlite3.Statement {
    // Normalize SQL for consistent caching
    const normalizedSql = this.normalizeSql(sql)

    // Check cache
    const cached = this.cache.get(normalizedSql)
    if (cached) {
      this.totalHits++
      cached.hits++
      cached.lastUsed = Date.now()
      return cached.statement
    }

    // Cache miss - create new statement
    this.totalMisses++

    // Get database connection
    const db = getDatabaseService().getDatabase()
    const statement = db.prepare(sql)

    // Estimate memory usage (rough approximation)
    const estimatedMemoryBytes = normalizedSql.length * 2 + 500 // SQL length + overhead

    // Add to cache
    const entry: CacheEntry = {
      statement,
      sql: normalizedSql,
      hits: 0,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      estimatedMemoryBytes
    }

    this.cache.set(normalizedSql, entry)

    // Check if we need to evict entries
    this.evictIfNeeded()

    return statement
  }

  /**
   * Evict oldest or least-used statements if cache is getting too large
   */
  private evictIfNeeded(): void {
    // Check size limit
    if (this.cache.size > this.maxCacheSize) {
      this.evictLeastUsed()
    }

    // Check memory limit
    const totalMemory = this.getTotalMemoryUsage()
    if (totalMemory > this.maxMemory) {
      this.evictLeastUsed()
    }
  }

  /**
   * Evict the least-used statements
   */
  private evictLeastUsed(): void {
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => {
        // Sort by hits (ascending) and then by last used time (oldest first)
        if (a[1].hits !== b[1].hits) {
          return a[1].hits - b[1].hits
        }
        return a[1].lastUsed - b[1].lastUsed
      })

    // Remove bottom 10% of cache
    const removeCount = Math.max(1, Math.ceil(this.cache.size * 0.1))
    for (let i = 0; i < removeCount; i++) {
      if (entries[i]) {
        this.cache.delete(entries[i][0])
      }
    }
  }

  /**
   * Normalize SQL for consistent caching
   * Removes excess whitespace and standardizes formatting
   */
  private normalizeSql(sql: string): string {
    return sql
      .trim()
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .toLowerCase() // Normalize case
  }

  /**
   * Get cache statistics
   */
  getStatistics(): CacheStatistics {
    const totalOps = this.totalHits + this.totalMisses
    const hitRate = totalOps > 0 ? (this.totalHits / totalOps) * 100 : 0

    // Get top statements by hit count
    const topStatements = Array.from(this.cache.entries())
      .map(([, entry]) => ({
        sql: entry.sql.substring(0, 100), // Truncate for display
        hits: entry.hits,
        memory: entry.estimatedMemoryBytes
      }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 10)

    return {
      totalStatements: this.cache.size,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      cacheHitRate: hitRate,
      estimatedMemoryBytes: this.getTotalMemoryUsage(),
      topStatements
    }
  }

  /**
   * Get total memory usage of cache
   */
  private getTotalMemoryUsage(): number {
    let total = 0
    for (const entry of this.cache.values()) {
      total += entry.estimatedMemoryBytes
    }
    return total
  }

  /**
   * Get total memory usage (public API)
   */
  getTotalMemory(): number {
    return this.getTotalMemoryUsage()
  }

  /**
   * Reset the cache
   */
  reset(): void {
    this.cache.clear()
    this.totalHits = 0
    this.totalMisses = 0
    console.log('[StatementCache] Cache reset')
  }

  /**
   * Clear cache and reset statistics
   */
  clear(): void {
    this.reset()
  }

  /**
   * Get statement by SQL (for debugging)
   */
  getStatement(sql: string): BetterSqlite3.Statement | undefined {
    const normalizedSql = this.normalizeSql(sql)
    return this.cache.get(normalizedSql)?.statement
  }

  /**
   * Get all cached statements info
   */
  getAllStatements(): Array<{
    sql: string
    hits: number
    memory: number
    lastUsed: number
  }> {
    return Array.from(this.cache.values()).map(entry => ({
      sql: entry.sql,
      hits: entry.hits,
      memory: entry.estimatedMemoryBytes,
      lastUsed: entry.lastUsed
    }))
  }

  /**
   * Log cache statistics (for debugging)
   */
  logStatistics(): void {
    const stats = this.getStatistics()
    console.log('[StatementCache] Statistics:')
    console.log(`  - Total statements: ${stats.totalStatements}`)
    console.log(`  - Total hits: ${stats.totalHits}`)
    console.log(`  - Total misses: ${stats.totalMisses}`)
    console.log(`  - Cache hit rate: ${stats.cacheHitRate.toFixed(2)}%`)
    console.log(`  - Memory usage: ${(stats.estimatedMemoryBytes / 1024 / 1024).toFixed(2)}MB`)
    console.log('  - Top statements:')
    stats.topStatements.forEach((stmt, i) => {
      console.log(`    ${i + 1}. ${stmt.sql}... (${stmt.hits} hits)`)
    })
  }
}

export const getStatementCache = (): StatementCache => {
  return StatementCache.getInstance()
}

export type { CacheStatistics }
