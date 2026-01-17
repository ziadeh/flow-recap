/**
 * Theme Store
 *
 * Manages dark mode theme state with persistence across sessions.
 * Supports light, dark, and system (auto-detect) modes.
 * Persists to localStorage for fast load and syncs with database.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

interface ThemeStore {
  theme: Theme
  resolvedTheme: ResolvedTheme

  // Actions
  setTheme: (theme: Theme) => void
  initializeTheme: () => Promise<void>
}

/**
 * Get the system's preferred color scheme
 */
function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Resolve the theme based on user preference and system settings
 */
function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') {
    return getSystemTheme()
  }
  return theme
}

/**
 * Apply the theme to the document
 */
function applyTheme(resolvedTheme: ResolvedTheme): void {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  if (resolvedTheme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'system',
      resolvedTheme: getSystemTheme(),

      setTheme: async (theme: Theme) => {
        const resolvedTheme = resolveTheme(theme)

        // Apply theme immediately
        applyTheme(resolvedTheme)

        // Update store state
        set({ theme, resolvedTheme })

        // Persist to database for cross-session sync
        try {
          await window.electronAPI.db.settings.set('appearance.theme', theme, 'appearance')
        } catch (err) {
          console.error('Failed to save theme to database:', err)
        }
      },

      initializeTheme: async () => {
        const state = get()

        // Try to load from database first (takes priority over localStorage)
        try {
          const dbTheme = await window.electronAPI.db.settings.get<Theme>('appearance.theme')
          if (dbTheme && ['light', 'dark', 'system'].includes(dbTheme)) {
            const resolvedTheme = resolveTheme(dbTheme)
            applyTheme(resolvedTheme)
            set({ theme: dbTheme, resolvedTheme })
            return
          }
        } catch (err) {
          console.error('Failed to load theme from database:', err)
        }

        // Fallback: use localStorage state (already loaded by zustand persist)
        const resolvedTheme = resolveTheme(state.theme)
        applyTheme(resolvedTheme)
        set({ resolvedTheme })
      },
    }),
    {
      name: 'theme-storage',
      version: 1,
      partialize: (state) => ({ theme: state.theme }),
      onRehydrateStorage: () => (state) => {
        // Apply theme immediately when localStorage is rehydrated
        if (state) {
          const resolvedTheme = resolveTheme(state.theme)
          applyTheme(resolvedTheme)
        }
      },
    }
  )
)

/**
 * Listen for system theme changes
 * Call this once in your app initialization
 */
export function setupSystemThemeListener(): () => void {
  if (typeof window === 'undefined') return () => {}

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

  const handleChange = () => {
    const state = useThemeStore.getState()
    if (state.theme === 'system') {
      const newResolvedTheme = getSystemTheme()
      applyTheme(newResolvedTheme)
      useThemeStore.setState({ resolvedTheme: newResolvedTheme })
    }
  }

  mediaQuery.addEventListener('change', handleChange)

  return () => {
    mediaQuery.removeEventListener('change', handleChange)
  }
}

export default useThemeStore
