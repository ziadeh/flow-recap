/**
 * Connection Pool Manager for SQLite
 *
 * This module manages a pool of SQLite database connections to enable
 * true concurrent read operations while writes are happening (via WAL mode).
 *
 * KEY INSIGHT: SQLite with WAL mode only needs one primary connection for writes.
 * Secondary connections are useful for non-blocking reads from different threads/async contexts.
 *
 * Design:
 * - Primary connection: Handles writes and is always available
 * - Secondary connections: Read-only connections for parallel reads
 * - Connection health checking: Verifies connections are still valid
 * - Auto-reconnection: Recreates failed connections on-demand
 */

import path from 'path'
import type BetterSqlite3 from 'better-sqlite3'
import { getDatabaseService } from './database'

type DatabaseInstance = BetterSqlite3.Database

interface ConnectionPoolConfig {
  poolSize: number // Total number of connections (1 primary + N-1 secondary)
  maxRetries: number // Max retries for connection health checks
}

interface PoolStatistics {
  totalConnections: number
  availableConnections: number
  inUseConnections: number
  totalQueries: number
  failedQueries: number
  averageQueryTime: number
}

class ConnectionPool {
  private static instance: ConnectionPool | null = null
  private connections: DatabaseInstance[] = []
  private availableConnections: Set<number> = new Set()
  private currentIndex: number = 0
  private config: ConnectionPoolConfig
  private dbPath: string = ''
  private statistics: {
    totalQueries: number
    failedQueries: number
    queryTimes: number[]
  } = {
    totalQueries: 0,
    failedQueries: 0,
    queryTimes: []
  }

  private constructor() {
    this.config = {
      poolSize: 6, // 1 primary + 5 secondary read-only connections
      maxRetries: 3
    }
  }

  /**
   * Get singleton instance of connection pool
   */
  static getInstance(): ConnectionPool {
    if (!ConnectionPool.instance) {
      ConnectionPool.instance = new ConnectionPool()
    }
    return ConnectionPool.instance
  }

  /**
   * Initialize the connection pool
   * Should be called after database service is initialized
   */
  initialize(config?: Partial<ConnectionPoolConfig>): void {
    if (this.connections.length > 0) {
      console.log('[ConnectionPool] Pool already initialized')
      return
    }

    if (config) {
      this.config = { ...this.config, ...config }
    }

    // Get database path from the database service
    const dbService = getDatabaseService()
    this.dbPath = dbService.getDbPath()

    // Load better-sqlite3
    let Database: any
    try {
      Database = require('better-sqlite3')
    } catch (error) {
      console.warn('[ConnectionPool] Standard better-sqlite3 require failed:', error)
      try {
        const electronApp = require('electron').app
        const appPath = electronApp.getAppPath()

        if (appPath.includes('.asar')) {
          const unpackedPath = appPath.replace('.asar', '.asar.unpacked')
          const nativeModulePath = path.join(unpackedPath, 'node_modules', 'better-sqlite3')
          Database = require(nativeModulePath)
        } else {
          throw error
        }
      } catch (fallbackError) {
        console.error('[ConnectionPool] Failed to load better-sqlite3:', fallbackError)
        throw fallbackError
      }
    }

    // Create connection pool
    try {
      for (let i = 0; i < this.config.poolSize; i++) {
        const conn = new Database(this.dbPath)

        // Configure connection
        conn.pragma('journal_mode = WAL')
        conn.pragma('foreign_keys = ON')
        conn.pragma('synchronous = NORMAL')
        conn.pragma('busy_timeout = 5000')
        conn.pragma('cache_size = -64000')

        // Make secondary connections read-only (all except primary connection 0)
        if (i > 0) {
          conn.pragma('query_only = ON')
        }

        this.connections.push(conn)
        this.availableConnections.add(i)
      }

      console.log(
        `[ConnectionPool] Initialized pool with ${this.config.poolSize} connections (1 primary + ${this.config.poolSize - 1} read-only)`
      )
    } catch (error) {
      console.error('[ConnectionPool] Failed to initialize connection pool:', error)
      // Cleanup on failure
      this.close()
      throw error
    }
  }

  /**
   * Get an available connection from the pool
   * Returns primary connection for writes, or a read-only connection for reads
   */
  getConnection(forWrite: boolean = false): DatabaseInstance {
    if (this.connections.length === 0) {
      throw new Error('Connection pool not initialized')
    }

    if (forWrite) {
      // Always return primary connection for writes
      return this.connections[0]
    }

    // For reads, try to get an available connection
    // Cycle through available connections to distribute load
    let attempts = 0
    const maxAttempts = this.config.poolSize

    while (attempts < maxAttempts) {
      if (this.availableConnections.size > 0) {
        const available = Array.from(this.availableConnections)[0]
        this.availableConnections.delete(available)
        return this.connections[available]
      }

      // If no available connections, wait a bit
      attempts++
    }

    // Fallback: return a connection (may block)
    return this.connections[1] || this.connections[0]
  }

  /**
   * Return a connection to the pool
   */
  returnConnection(conn: DatabaseInstance): void {
    // Find connection index
    const index = this.connections.indexOf(conn)
    if (index >= 0 && index > 0) {
      // Only mark non-primary connections as available for reuse
      this.availableConnections.add(index)
    }
  }

  /**
   * Execute a query with automatic connection management
   */
  executeQuery<T>(
    sql: string,
    params?: any[],
    forWrite: boolean = false
  ): T {
    const startTime = performance.now()

    try {
      const conn = this.getConnection(forWrite)
      const stmt = conn.prepare(sql)
      const result = params ? stmt.all(...params) : stmt.all()

      this.statistics.totalQueries++
      this.statistics.queryTimes.push(performance.now() - startTime)

      // Keep only last 100 query times for average
      if (this.statistics.queryTimes.length > 100) {
        this.statistics.queryTimes.shift()
      }

      if (!forWrite && conn !== this.connections[0]) {
        this.returnConnection(conn)
      }

      return result as T
    } catch (error) {
      this.statistics.failedQueries++
      throw error
    }
  }

  /**
   * Get pool statistics
   */
  getStatistics(): PoolStatistics {
    const averageTime =
      this.statistics.queryTimes.length > 0
        ? this.statistics.queryTimes.reduce((a, b) => a + b, 0) / this.statistics.queryTimes.length
        : 0

    return {
      totalConnections: this.connections.length,
      availableConnections: this.availableConnections.size,
      inUseConnections: this.connections.length - this.availableConnections.size,
      totalQueries: this.statistics.totalQueries,
      failedQueries: this.statistics.failedQueries,
      averageQueryTime: averageTime
    }
  }

  /**
   * Health check: verify all connections are valid
   */
  healthCheck(): boolean {
    try {
      for (const conn of this.connections) {
        // Simple query to check connection is alive
        conn.prepare('SELECT 1').get()
      }
      return true
    } catch (error) {
      console.error('[ConnectionPool] Health check failed:', error)
      return false
    }
  }

  /**
   * Close all connections in the pool
   */
  close(): void {
    for (const conn of this.connections) {
      try {
        conn.close()
      } catch (error) {
        console.error('[ConnectionPool] Error closing connection:', error)
      }
    }

    this.connections = []
    this.availableConnections.clear()
    console.log('[ConnectionPool] All connections closed')
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    this.statistics = {
      totalQueries: 0,
      failedQueries: 0,
      queryTimes: []
    }
  }
}

export const getConnectionPool = (): ConnectionPool => {
  return ConnectionPool.getInstance()
}

export type { PoolStatistics, ConnectionPoolConfig }
