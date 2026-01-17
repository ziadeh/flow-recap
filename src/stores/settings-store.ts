/**
 * Settings Store
 * 
 * Manages global state for user preferences and settings
 */

import { create } from 'zustand'
import type { Setting, SettingCategory } from '../types/database'

interface SettingsStore {
  settings: Record<string, Setting>
  isLoading: boolean
  
  // Actions
  setSetting: (key: string, setting: Setting) => void
  setSettings: (settings: Setting[]) => void
  getSetting: <T = unknown>(key: string) => T | null
  removeSetting: (key: string) => void
  getSettingsByCategory: (category: SettingCategory) => Setting[]
  setLoading: (isLoading: boolean) => void
  clearSettings: () => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: {},
  isLoading: false,

  setSetting: (key: string, setting: Setting) =>
    set((state) => ({
      settings: { ...state.settings, [key]: setting }
    })),

  setSettings: (settings: Setting[]) =>
    set({
      settings: settings.reduce((acc, setting) => {
        acc[setting.key] = setting
        return acc
      }, {} as Record<string, Setting>)
    }),

  getSetting: <T = unknown>(key: string): T | null => {
    const setting = get().settings[key]
    if (!setting) return null
    
    try {
      return JSON.parse(setting.value) as T
    } catch {
      return setting.value as unknown as T
    }
  },

  removeSetting: (key: string) =>
    set((state) => {
      const { [key]: removed, ...rest } = state.settings
      return { settings: rest }
    }),

  getSettingsByCategory: (category: SettingCategory): Setting[] => {
    return Object.values(get().settings).filter(
      (setting) => setting.category === category
    )
  },

  setLoading: (isLoading: boolean) =>
    set({ isLoading }),

  clearSettings: () =>
    set({ settings: {}, isLoading: false })
}))
