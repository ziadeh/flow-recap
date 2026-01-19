import { useEffect, useRef, useState } from 'react'

/**
 * Options for useIntersectionObserver hook
 */
export interface UseIntersectionObserverOptions {
  /** Margin around the root element. Can be negative. Default: '0px' */
  rootMargin?: string
  /** Intersection threshold value(s). Default: 0 */
  threshold?: number | number[]
  /** Root element for intersection. Default: viewport */
  root?: Element | null
  /** If true, stop observing after first intersection. Default: true */
  once?: boolean
}

/**
 * Return type for useIntersectionObserver hook
 */
export interface UseIntersectionObserverReturn {
  /** Ref to attach to the element you want to observe */
  ref: React.RefObject<HTMLDivElement>
  /** Whether the element is currently visible in the viewport */
  isVisible: boolean
  /** Whether the element has ever been visible (useful for lazy loading) */
  hasBeenVisible: boolean
}

/**
 * Hook to detect when an element enters/leaves the viewport using Intersection Observer API
 * Useful for lazy loading, infinite scroll, and visibility-based effects
 *
 * @param options - Configuration options for the intersection observer
 * @returns Object with ref, isVisible state, and hasBeenVisible flag
 *
 * @example
 * const { ref, isVisible } = useIntersectionObserver({
 *   rootMargin: '100px', // Start loading before fully visible
 *   once: true // Stop observing after first intersection
 * })
 *
 * return <div ref={ref}>
 *   {isVisible ? <HeavyComponent /> : <Skeleton />}
 * </div>
 */
export function useIntersectionObserver(
  options: UseIntersectionObserverOptions = {}
): UseIntersectionObserverReturn {
  const ref = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [hasBeenVisible, setHasBeenVisible] = useState(false)

  const {
    rootMargin = '0px',
    threshold = 0,
    root = null,
    once = true
  } = options

  useEffect(() => {
    // Check if IntersectionObserver is available (all modern browsers)
    if (!ref.current || typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      // Fallback: mark as visible if observer not available
      setIsVisible(true)
      setHasBeenVisible(true)
      return
    }

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          setHasBeenVisible(true)

          // Stop observing after first intersection if once=true
          if (once && ref.current && observer) {
            observer.unobserve(ref.current)
          }
        } else {
          // Only set isVisible to false if not in once mode
          // In once mode, we keep it visible since we've already unobserved
          if (!once) {
            setIsVisible(false)
          }
        }
      })
    }

    const observer = new IntersectionObserver(handleIntersection, {
      root,
      rootMargin,
      threshold
    })

    if (ref.current) {
      observer.observe(ref.current)
    }

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current)
      }
      observer.disconnect()
    }
  }, [rootMargin, threshold, root, once])

  return {
    ref,
    isVisible: hasBeenVisible || isVisible, // Return true if ever visible or currently visible
    hasBeenVisible
  }
}
