/**
 * Performance Profiling Utilities
 *
 * Utilities for measuring and logging component render performance in development.
 */

export interface PerformanceMetrics {
  componentName: string
  renderTime: number
  timestamp: number
}

const metrics: PerformanceMetrics[] = []

/**
 * Measure component render time
 */
export function measureRender(componentName: string, callback: () => void): void {
  if (import.meta.env.DEV) {
    const start = performance.now()
    callback()
    const end = performance.now()
    const renderTime = end - start

    metrics.push({
      componentName,
      renderTime,
      timestamp: Date.now(),
    })

    if (renderTime > 16) {
      // Warn if render takes longer than 1 frame (16ms at 60fps)
      console.warn(
        `[Performance] ${componentName} took ${renderTime.toFixed(2)}ms to render (>16ms)`,
        {
          renderTime,
          componentName,
        }
      )
    }
  } else {
    callback()
  }
}

/**
 * Create a performance profiler hook
 */
export function usePerformanceProfiler(componentName: string): void {
  if (import.meta.env.DEV) {
    const renderCount = React.useRef(0)
    const startTime = React.useRef(performance.now())

    React.useEffect(() => {
      renderCount.current++
      const endTime = performance.now()
      const renderTime = endTime - startTime.current

      if (renderTime > 16) {
        console.warn(
          `[Performance] ${componentName} render #${renderCount.current} took ${renderTime.toFixed(2)}ms`,
          {
            renderTime,
            renderCount: renderCount.current,
          }
        )
      }

      startTime.current = performance.now()
    })
  }
}

/**
 * Get all performance metrics
 */
export function getPerformanceMetrics(): PerformanceMetrics[] {
  return metrics
}

/**
 * Get slow components (>16ms render time)
 */
export function getSlowComponents(): PerformanceMetrics[] {
  return metrics.filter((m) => m.renderTime > 16)
}

/**
 * Clear all performance metrics
 */
export function clearPerformanceMetrics(): void {
  metrics.length = 0
}

/**
 * Log performance summary
 */
export function logPerformanceSummary(): void {
  if (metrics.length === 0) {
    console.log('[Performance] No metrics collected')
    return
  }

  const slowComponents = getSlowComponents()
  const avgRenderTime = metrics.reduce((sum, m) => sum + m.renderTime, 0) / metrics.length

  console.group('[Performance] Summary')
  console.log(`Total renders measured: ${metrics.length}`)
  console.log(`Average render time: ${avgRenderTime.toFixed(2)}ms`)
  console.log(`Slow renders (>16ms): ${slowComponents.length}`)

  if (slowComponents.length > 0) {
    console.group('Slow Components')
    slowComponents.forEach((m) => {
      console.log(`${m.componentName}: ${m.renderTime.toFixed(2)}ms`)
    })
    console.groupEnd()
  }

  console.groupEnd()
}

// Make performance utilities available globally in dev mode
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as any).__performance__ = {
    getMetrics: getPerformanceMetrics,
    getSlowComponents,
    clearMetrics: clearPerformanceMetrics,
    logSummary: logPerformanceSummary,
  }
}

import React from 'react'
