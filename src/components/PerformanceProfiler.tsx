/**
 * PerformanceProfiler Component
 *
 * A development-only component that shows performance metrics for the current page.
 * Only renders in development mode.
 */

import { useEffect, useState } from 'react'
import { Activity, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PerformanceMetric {
  name: string
  value: number
  unit: string
  status: 'good' | 'warning' | 'bad'
}

export function PerformanceProfiler() {
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    // Only show in development
    if (import.meta.env.PROD) {
      return
    }

    setIsVisible(true)

    const updateMetrics = () => {
      const perfData = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined

      if (!perfData) return

      const newMetrics: PerformanceMetric[] = []

      // DOM Interactive (when DOM is ready)
      const domInteractive = perfData.domInteractive
      newMetrics.push({
        name: 'DOM Interactive',
        value: Math.round(domInteractive),
        unit: 'ms',
        status: domInteractive < 500 ? 'good' : domInteractive < 1000 ? 'warning' : 'bad',
      })

      // DOM Complete (when all resources loaded)
      const domComplete = perfData.domComplete
      newMetrics.push({
        name: 'DOM Complete',
        value: Math.round(domComplete),
        unit: 'ms',
        status: domComplete < 1500 ? 'good' : domComplete < 3000 ? 'warning' : 'bad',
      })

      // Load Event (when page fully loaded)
      const loadTime = perfData.loadEventEnd - perfData.loadEventStart
      newMetrics.push({
        name: 'Load Event',
        value: Math.round(loadTime),
        unit: 'ms',
        status: loadTime < 100 ? 'good' : loadTime < 300 ? 'warning' : 'bad',
      })

      // Time to First Byte
      const ttfb = perfData.responseStart - perfData.requestStart
      newMetrics.push({
        name: 'TTFB',
        value: Math.round(ttfb),
        unit: 'ms',
        status: ttfb < 200 ? 'good' : ttfb < 500 ? 'warning' : 'bad',
      })

      // Check for long tasks
      const longTasks = performance.getEntriesByType('measure').filter(
        (entry) => entry.duration > 50
      )
      if (longTasks.length > 0) {
        const longestTask = Math.max(...longTasks.map((t) => t.duration))
        newMetrics.push({
          name: 'Longest Task',
          value: Math.round(longestTask),
          unit: 'ms',
          status: longestTask < 50 ? 'good' : longestTask < 100 ? 'warning' : 'bad',
        })
      }

      setMetrics(newMetrics)
    }

    // Update metrics after page load
    if (document.readyState === 'complete') {
      updateMetrics()
    } else {
      window.addEventListener('load', updateMetrics)
      return () => window.removeEventListener('load', updateMetrics)
    }
  }, [])

  if (!isVisible) return null

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-lg shadow-lg hover:bg-purple-700 transition-colors"
          title="Show performance metrics"
        >
          <Activity className="w-4 h-4" />
          <span className="text-sm font-medium">Performance</span>
        </button>
      ) : (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-4 w-80">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-600" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Performance Metrics
              </h3>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            {metrics.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">Loading metrics...</p>
            ) : (
              metrics.map((metric) => (
                <div key={metric.name} className="flex items-center justify-between">
                  <span className="text-xs text-gray-600 dark:text-gray-400">{metric.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {metric.value}
                      {metric.unit}
                    </span>
                    <div
                      className={cn(
                        'w-2 h-2 rounded-full',
                        metric.status === 'good' && 'bg-green-500',
                        metric.status === 'warning' && 'bg-yellow-500',
                        metric.status === 'bad' && 'bg-red-500'
                      )}
                      title={metric.status}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => {
                window.location.reload()
              }}
              className="w-full text-xs text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 font-medium"
            >
              Reload & Re-measure
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span>Good</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
              <span>OK</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span>Slow</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PerformanceProfiler
