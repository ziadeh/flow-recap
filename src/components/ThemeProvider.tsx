/**
 * Theme Provider Component
 *
 * Initializes and manages the application theme.
 * - Loads theme preference from database on mount
 * - Listens for system theme changes
 * - Applies theme class to document root
 */

import { useEffect, ReactNode } from 'react'
import { useThemeStore, setupSystemThemeListener } from '@/stores/theme-store'

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const initializeTheme = useThemeStore((state) => state.initializeTheme)

  useEffect(() => {
    // Initialize theme from database/localStorage
    initializeTheme()

    // Setup listener for system theme changes
    const cleanup = setupSystemThemeListener()

    return cleanup
  }, [initializeTheme])

  return <>{children}</>
}

export default ThemeProvider
