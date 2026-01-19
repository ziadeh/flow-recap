import { ReactNode } from 'react'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'
import { cn } from '@/lib/utils'

/**
 * Props for LazyLoadContainer component
 */
export interface LazyLoadContainerProps {
  /** Content to render once the element is visible */
  children: ReactNode
  /** Fallback/placeholder content shown while off-screen */
  fallback?: ReactNode
  /** Intersection threshold (0-1). Default: 0 */
  threshold?: number
  /** Root margin for early loading. Default: '0px' */
  rootMargin?: string
  /** Callback fired when element becomes visible */
  onVisible?: () => void
  /** CSS class name to apply to the wrapper div */
  className?: string
  /** Test ID for the wrapper element */
  testId?: string
}

/**
 * LazyLoadContainer Component
 *
 * Lazy loads content when it enters the viewport using Intersection Observer.
 * Renders a fallback (usually a skeleton) until the content is visible,
 * then renders the actual children once visible.
 *
 * This is useful for performance optimization in large lists where you want
 * to defer rendering of off-screen items.
 *
 * @example
 * // Basic usage with metadata skeleton
 * <LazyLoadContainer
 *   fallback={<MeetingCardMetadataSkeleton />}
 *   rootMargin="100px"
 * >
 *   <MeetingCardMetadata meeting={meeting} />
 * </LazyLoadContainer>
 *
 * @example
 * // With callback
 * <LazyLoadContainer
 *   fallback={<Skeleton />}
 *   onVisible={() => console.log('Content loaded')}
 * >
 *   <ExpensiveComponent />
 * </LazyLoadContainer>
 */
export function LazyLoadContainer({
  children,
  fallback = null,
  threshold = 0,
  rootMargin = '0px',
  onVisible,
  className,
  testId = 'lazy-load-container'
}: LazyLoadContainerProps) {
  const { ref, isVisible, hasBeenVisible } = useIntersectionObserver({
    threshold,
    rootMargin,
    once: true // Only load once
  })

  // Fire callback when becoming visible
  if (isVisible && !hasBeenVisible && onVisible) {
    onVisible()
  }

  // If element has been visible, render children
  // (keep rendering after load for performance)
  const shouldRenderChildren = hasBeenVisible || isVisible

  return (
    <div
      ref={ref}
      className={cn(className)}
      data-testid={testId}
      data-lazy-loaded={shouldRenderChildren}
    >
      {shouldRenderChildren ? children : fallback}
    </div>
  )
}
