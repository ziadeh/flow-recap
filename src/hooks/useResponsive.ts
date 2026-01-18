import { useState, useEffect, useCallback } from 'react'

/**
 * Responsive Breakpoint Hook
 *
 * Breakpoint definitions matching the feature requirements:
 * - Mobile: < 768px
 * - Tablet: 768px - 1024px
 * - Desktop: > 1024px
 */

export type DeviceType = 'mobile' | 'tablet' | 'desktop'

export interface ResponsiveState {
  /** Current device type */
  deviceType: DeviceType
  /** Whether device is mobile (< 768px) */
  isMobile: boolean
  /** Whether device is tablet (768px - 1024px) */
  isTablet: boolean
  /** Whether device is desktop (> 1024px) */
  isDesktop: boolean
  /** Whether device is touch-capable */
  isTouchDevice: boolean
  /** Current viewport width */
  width: number
  /** Current viewport height */
  height: number
}

// Breakpoint values in pixels
export const BREAKPOINTS = {
  mobile: 768,
  tablet: 1024,
} as const

/**
 * Hook to track responsive breakpoints and device type
 *
 * Usage:
 * ```tsx
 * const { isMobile, isTablet, isDesktop, deviceType } = useResponsive()
 *
 * return (
 *   <div className={isMobile ? 'flex-col' : 'flex-row'}>
 *     {isMobile && <MobileNavigation />}
 *     {!isMobile && <DesktopNavigation />}
 *   </div>
 * )
 * ```
 */
export function useResponsive(): ResponsiveState {
  const getResponsiveState = useCallback((): ResponsiveState => {
    // Default values for SSR
    if (typeof window === 'undefined') {
      return {
        deviceType: 'desktop',
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        isTouchDevice: false,
        width: 1200,
        height: 800,
      }
    }

    const width = window.innerWidth
    const height = window.innerHeight
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0

    let deviceType: DeviceType
    let isMobile = false
    let isTablet = false
    let isDesktop = false

    if (width < BREAKPOINTS.mobile) {
      deviceType = 'mobile'
      isMobile = true
    } else if (width >= BREAKPOINTS.mobile && width <= BREAKPOINTS.tablet) {
      deviceType = 'tablet'
      isTablet = true
    } else {
      deviceType = 'desktop'
      isDesktop = true
    }

    return {
      deviceType,
      isMobile,
      isTablet,
      isDesktop,
      isTouchDevice,
      width,
      height,
    }
  }, [])

  const [state, setState] = useState<ResponsiveState>(getResponsiveState)

  useEffect(() => {
    // Update state on mount
    setState(getResponsiveState())

    // Debounced resize handler
    let timeoutId: ReturnType<typeof setTimeout>
    const handleResize = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        setState(getResponsiveState())
      }, 100) // Debounce 100ms
    }

    window.addEventListener('resize', handleResize)

    // Also listen for orientation change on mobile devices
    window.addEventListener('orientationchange', handleResize)

    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [getResponsiveState])

  return state
}

/**
 * Utility function to get CSS classes based on breakpoints
 *
 * Usage:
 * ```tsx
 * const classes = getResponsiveClasses({
 *   base: 'p-2',
 *   mobile: 'p-sm',
 *   tablet: 'p-md',
 *   desktop: 'p-lg'
 * }, deviceType)
 * ```
 */
export function getResponsiveClasses(
  classMap: {
    base?: string
    mobile?: string
    tablet?: string
    desktop?: string
  },
  deviceType: DeviceType
): string {
  const classes: string[] = []

  if (classMap.base) {
    classes.push(classMap.base)
  }

  switch (deviceType) {
    case 'mobile':
      if (classMap.mobile) classes.push(classMap.mobile)
      break
    case 'tablet':
      if (classMap.tablet) classes.push(classMap.tablet)
      break
    case 'desktop':
      if (classMap.desktop) classes.push(classMap.desktop)
      break
  }

  return classes.join(' ')
}

/**
 * Responsive padding utilities based on design tokens
 *
 * Mobile: sm (8px)
 * Tablet: md (12px)
 * Desktop: lg (16px)
 */
export const responsivePadding = {
  mobile: 'p-token-sm',
  tablet: 'p-token-md',
  desktop: 'p-token-lg',
}

export const responsivePaddingX = {
  mobile: 'px-token-sm',
  tablet: 'px-token-md',
  desktop: 'px-token-lg',
}

export const responsivePaddingY = {
  mobile: 'py-token-sm',
  tablet: 'py-token-md',
  desktop: 'py-token-lg',
}

export const responsiveGap = {
  mobile: 'gap-token-sm',
  tablet: 'gap-token-md',
  desktop: 'gap-token-lg',
}

export default useResponsive
