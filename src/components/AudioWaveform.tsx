/**
 * AudioWaveform Component
 *
 * A visual audio waveform visualizer that responds to incoming audio levels.
 * Designed for use in the header during active recording sessions.
 * Includes simulation mode for when real audio data isn't available.
 */

import { useMemo, useEffect, useState, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface AudioWaveformProps {
  /** Audio level from 0-100 (optional - will simulate if not provided or 0) */
  level?: number
  /** Additional CSS classes */
  className?: string
  /** Number of bars to display */
  barCount?: number
  /** Whether animation is active */
  isAnimating?: boolean
}

export function AudioWaveform({
  level = 0,
  className,
  barCount = 28,
  isAnimating = true
}: AudioWaveformProps) {
  const [barHeights, setBarHeights] = useState<number[]>(() => Array(barCount).fill(0.15))
  const animationRef = useRef<number | null>(null)
  const lastUpdateRef = useRef<number>(0)

  // Generate stable bar patterns that persist across renders
  const barPatterns = useMemo(() => {
    return Array(barCount).fill(0).map((_, i) => ({
      // Create a wave-like pattern across the bars
      baseMultiplier: 0.5 + Math.sin((i / barCount) * Math.PI) * 0.5,
      // Random offset for variation
      phaseOffset: Math.random() * Math.PI * 2,
      // Speed variation for each bar
      speedFactor: 0.8 + Math.random() * 0.4
    }))
  }, [barCount])

  // Generate simulated audio level when no real data
  const generateSimulatedLevel = useCallback(() => {
    // Create natural-looking audio levels with some variation
    const baseLevel = 35 + Math.random() * 35 // Between 35-70%
    const variation = (Math.random() - 0.5) * 20 // ±10 variation
    return Math.max(10, Math.min(90, baseLevel + variation))
  }, [])

  // Animation loop
  useEffect(() => {
    if (!isAnimating) {
      setBarHeights(Array(barCount).fill(0.15))
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
      return
    }

    const animate = (timestamp: number) => {
      // Limit update rate to ~30fps for performance
      if (timestamp - lastUpdateRef.current < 33) {
        animationRef.current = requestAnimationFrame(animate)
        return
      }
      lastUpdateRef.current = timestamp

      // Use real audio level if available, otherwise simulate
      const effectiveLevel = level > 0 ? level : generateSimulatedLevel()
      const normalizedLevel = effectiveLevel / 100

      // Generate new heights for each bar
      const newHeights = barPatterns.map((pattern, index) => {
        // Create wave effect based on time and bar position
        const time = timestamp / 1000
        const wavePhase = (index / barCount) * Math.PI * 2
        const timeWave = Math.sin(time * 3 * pattern.speedFactor + pattern.phaseOffset + wavePhase)

        // Combine base level with wave animation
        const waveContribution = 0.3 + timeWave * 0.2 // 0.1 to 0.5 wave
        const levelContribution = normalizedLevel * 0.7 // Audio level contribution

        // Calculate final height with pattern multiplier
        const rawHeight = (waveContribution + levelContribution) * pattern.baseMultiplier

        // Add some random noise for organic feel
        const noise = (Math.random() - 0.5) * 0.15

        // Clamp between min and max
        return Math.max(0.15, Math.min(1, rawHeight + noise))
      })

      setBarHeights(newHeights)
      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
    }
  }, [isAnimating, level, barCount, barPatterns, generateSimulatedLevel])

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-[2px] h-10',
        className
      )}
      role="img"
      aria-label="Audio waveform visualization"
    >
      {barHeights.map((height, index) => (
        <div
          key={index}
          className="w-[3px] rounded-full bg-[#3B9BD3] transition-[height] duration-75 ease-out"
          style={{
            height: `${Math.max(4, height * 32)}px`,
            opacity: 0.6 + height * 0.4
          }}
        />
      ))}
    </div>
  )
}
