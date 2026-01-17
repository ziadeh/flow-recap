/**
 * Performance Monitoring Utilities
 *
 * Provides utilities for monitoring application performance including:
 * - Memory usage tracking
 * - Render time measurements
 * - Component profiling
 * - Query performance tracking
 */

// Memory usage snapshot type
export interface MemorySnapshot {
  timestamp: number
  heapUsed: number // JS heap size used
  heapTotal: number // Total JS heap size
  external: number // External memory (C++ objects)
  arrayBuffers: number // ArrayBuffer memory
  rss?: number // Resident Set Size (if available)
}

// Performance metric type
export interface PerformanceMetric {
  name: string
  startTime: number
  endTime?: number
  duration?: number
  metadata?: Record<string, unknown>
}

// Query performance tracking
export interface QueryMetric {
  query: string
  duration: number
  rowCount?: number
  timestamp: number
}

// Component render tracking
export interface RenderMetric {
  componentName: string
  renderCount: number
  totalRenderTime: number
  averageRenderTime: number
  lastRenderTime: number
}

class PerformanceMonitor {
  private static instance: PerformanceMonitor
  private memorySnapshots: MemorySnapshot[] = []
  private metrics: Map<string, PerformanceMetric> = new Map()
  private queryMetrics: QueryMetric[] = []
  private renderMetrics: Map<string, RenderMetric> = new Map()
  private isEnabled: boolean = true
  private maxSnapshots: number = 100
  private maxQueryMetrics: number = 100

  private constructor() {}

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor()
    }
    return PerformanceMonitor.instance
  }

  /**
   * Enable/disable performance monitoring
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled
  }

  /**
   * Check if monitoring is enabled
   */
  getIsEnabled(): boolean {
    return this.isEnabled
  }

  /**
   * Take a memory snapshot
   */
  takeMemorySnapshot(): MemorySnapshot | null {
    if (!this.isEnabled) return null

    // Check if we're in a browser environment with performance.memory
    // Note: performance.memory is only available in Chrome and requires specific flags
    const memoryInfo = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: memoryInfo?.usedJSHeapSize ?? 0,
      heapTotal: memoryInfo?.totalJSHeapSize ?? 0,
      external: 0,
      arrayBuffers: 0
    }

    this.memorySnapshots.push(snapshot)

    // Keep only the most recent snapshots
    if (this.memorySnapshots.length > this.maxSnapshots) {
      this.memorySnapshots.shift()
    }

    return snapshot
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): {
    current: MemorySnapshot | null
    peak: MemorySnapshot | null
    average: number
    trend: 'increasing' | 'stable' | 'decreasing'
  } {
    if (this.memorySnapshots.length === 0) {
      return { current: null, peak: null, average: 0, trend: 'stable' }
    }

    const current = this.memorySnapshots[this.memorySnapshots.length - 1]
    const peak = this.memorySnapshots.reduce((max, snap) =>
      snap.heapUsed > max.heapUsed ? snap : max
    )
    const average = this.memorySnapshots.reduce((sum, snap) =>
      sum + snap.heapUsed, 0
    ) / this.memorySnapshots.length

    // Calculate trend based on recent snapshots
    let trend: 'increasing' | 'stable' | 'decreasing' = 'stable'
    if (this.memorySnapshots.length >= 5) {
      const recent = this.memorySnapshots.slice(-5)
      const first = recent[0].heapUsed
      const last = recent[recent.length - 1].heapUsed
      const change = (last - first) / first

      if (change > 0.1) trend = 'increasing'
      else if (change < -0.1) trend = 'decreasing'
    }

    return { current, peak, average, trend }
  }

  /**
   * Start measuring a performance metric
   */
  startMetric(name: string, metadata?: Record<string, unknown>): void {
    if (!this.isEnabled) return

    this.metrics.set(name, {
      name,
      startTime: performance.now(),
      metadata
    })
  }

  /**
   * End measuring a performance metric
   */
  endMetric(name: string): PerformanceMetric | null {
    if (!this.isEnabled) return null

    const metric = this.metrics.get(name)
    if (!metric) return null

    metric.endTime = performance.now()
    metric.duration = metric.endTime - metric.startTime

    return metric
  }

  /**
   * Measure a function execution time
   */
  async measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<{ result: T; duration: number }> {
    this.startMetric(name, metadata)
    const result = await fn()
    const metric = this.endMetric(name)
    return { result, duration: metric?.duration ?? 0 }
  }

  /**
   * Measure synchronous function execution time
   */
  measure<T>(
    name: string,
    fn: () => T,
    metadata?: Record<string, unknown>
  ): { result: T; duration: number } {
    this.startMetric(name, metadata)
    const result = fn()
    const metric = this.endMetric(name)
    return { result, duration: metric?.duration ?? 0 }
  }

  /**
   * Track a database query
   */
  trackQuery(query: string, duration: number, rowCount?: number): void {
    if (!this.isEnabled) return

    this.queryMetrics.push({
      query,
      duration,
      rowCount,
      timestamp: Date.now()
    })

    // Keep only recent queries
    if (this.queryMetrics.length > this.maxQueryMetrics) {
      this.queryMetrics.shift()
    }
  }

  /**
   * Get query statistics
   */
  getQueryStats(): {
    totalQueries: number
    averageDuration: number
    slowestQuery: QueryMetric | null
    recentQueries: QueryMetric[]
  } {
    if (this.queryMetrics.length === 0) {
      return { totalQueries: 0, averageDuration: 0, slowestQuery: null, recentQueries: [] }
    }

    const averageDuration = this.queryMetrics.reduce((sum, q) =>
      sum + q.duration, 0
    ) / this.queryMetrics.length

    const slowestQuery = this.queryMetrics.reduce((max, q) =>
      q.duration > (max?.duration ?? 0) ? q : max
    , this.queryMetrics[0])

    return {
      totalQueries: this.queryMetrics.length,
      averageDuration,
      slowestQuery,
      recentQueries: this.queryMetrics.slice(-10)
    }
  }

  /**
   * Track component render
   */
  trackRender(componentName: string, renderTime: number): void {
    if (!this.isEnabled) return

    const existing = this.renderMetrics.get(componentName)

    if (existing) {
      existing.renderCount++
      existing.totalRenderTime += renderTime
      existing.averageRenderTime = existing.totalRenderTime / existing.renderCount
      existing.lastRenderTime = renderTime
    } else {
      this.renderMetrics.set(componentName, {
        componentName,
        renderCount: 1,
        totalRenderTime: renderTime,
        averageRenderTime: renderTime,
        lastRenderTime: renderTime
      })
    }
  }

  /**
   * Get render statistics
   */
  getRenderStats(): RenderMetric[] {
    return Array.from(this.renderMetrics.values())
      .sort((a, b) => b.totalRenderTime - a.totalRenderTime)
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.memorySnapshots = []
    this.metrics.clear()
    this.queryMetrics = []
    this.renderMetrics.clear()
  }

  /**
   * Export all metrics as JSON
   */
  exportMetrics(): string {
    return JSON.stringify({
      memorySnapshots: this.memorySnapshots,
      metrics: Array.from(this.metrics.values()),
      queryMetrics: this.queryMetrics,
      renderMetrics: Array.from(this.renderMetrics.values()),
      exportedAt: new Date().toISOString()
    }, null, 2)
  }

  /**
   * Log current performance summary to console
   */
  logSummary(): void {
    const memoryStats = this.getMemoryStats()
    const queryStats = this.getQueryStats()
    const renderStats = this.getRenderStats()

    console.group('📊 Performance Summary')

    console.group('💾 Memory')
    if (memoryStats.current) {
      console.log(`Current heap: ${this.formatBytes(memoryStats.current.heapUsed)}`)
      console.log(`Peak heap: ${memoryStats.peak ? this.formatBytes(memoryStats.peak.heapUsed) : 'N/A'}`)
      console.log(`Trend: ${memoryStats.trend}`)
    } else {
      console.log('No memory data available')
    }
    console.groupEnd()

    console.group('🔍 Queries')
    console.log(`Total queries: ${queryStats.totalQueries}`)
    console.log(`Average duration: ${queryStats.averageDuration.toFixed(2)}ms`)
    if (queryStats.slowestQuery) {
      console.log(`Slowest query: ${queryStats.slowestQuery.duration.toFixed(2)}ms`)
    }
    console.groupEnd()

    console.group('🎨 Renders')
    renderStats.slice(0, 5).forEach(r => {
      console.log(`${r.componentName}: ${r.renderCount} renders, avg ${r.averageRenderTime.toFixed(2)}ms`)
    })
    console.groupEnd()

    console.groupEnd()
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }
}

// Singleton instance
export const performanceMonitor = PerformanceMonitor.getInstance()

/**
 * React hook for component render tracking
 */
export function useRenderTracking(componentName: string): void {
  const startTime = performance.now()

  // Use a microtask to track render completion
  queueMicrotask(() => {
    const renderTime = performance.now() - startTime
    performanceMonitor.trackRender(componentName, renderTime)
  })
}

/**
 * Higher-order function to wrap async functions with performance tracking
 */
export function withPerformanceTracking<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  name: string
): T {
  return (async (...args: Parameters<T>) => {
    const { result } = await performanceMonitor.measureAsync(name, () => fn(...args))
    return result
  }) as T
}

/**
 * Start periodic memory monitoring
 */
export function startMemoryMonitoring(intervalMs: number = 30000): () => void {
  const intervalId = setInterval(() => {
    performanceMonitor.takeMemorySnapshot()
  }, intervalMs)

  // Take initial snapshot
  performanceMonitor.takeMemorySnapshot()

  // Return cleanup function
  return () => clearInterval(intervalId)
}

export default performanceMonitor
