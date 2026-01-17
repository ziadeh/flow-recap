/**
 * AudioLevelMeter Component
 *
 * Visual audio level meter component showing audio input levels
 */

import { cn } from '@/lib/utils'

interface AudioLevelMeterProps {
  level: number // 0-100
  className?: string
}

export function AudioLevelMeter({ level, className }: AudioLevelMeterProps) {
  // Clamp level between 0 and 100
  const clampedLevel = Math.max(0, Math.min(100, level))

  // Calculate number of bars to show (10 bars total)
  const numBars = 10
  const barsPerLevel = numBars / 100
  const activeBars = Math.ceil(clampedLevel * barsPerLevel)

  // Determine color based on level
  const getBarColor = (index: number) => {
    if (index < activeBars) {
      if (index < 6) {
        return 'bg-green-500' // Low levels - green
      } else if (index < 8) {
        return 'bg-yellow-500' // Medium levels - yellow
      } else {
        return 'bg-red-500' // High levels - red
      }
    }
    return 'bg-gray-200 dark:bg-gray-700' // Inactive bars
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {Array.from({ length: numBars }).map((_, index) => (
        <div
          key={index}
          className={cn(
            'w-1 rounded-full transition-all duration-75',
            getBarColor(index)
          )}
          style={{
            height: `${(index + 1) * 4 + 8}px` // Increasing height for each bar
          }}
        />
      ))}
    </div>
  )
}
