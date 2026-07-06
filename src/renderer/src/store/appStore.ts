import { create } from 'zustand'
import type { AppConfig, Result } from '@shared/domain'
import i18n from '@/i18n'
import { applyTheme } from '@/theme/themes'

export type AppView = 'calendar' | 'projects' | 'settings'

interface AppState {
  config: AppConfig
  view: AppView
  setView(view: AppView): void
  /** Persists the config and applies theme/language side effects. */
  saveConfig(config: AppConfig): Promise<Result<void>>
  /** Updates lastUsed without any UI side effects. */
  rememberLastUsed(lastUsed: AppConfig['lastUsed']): void
}

export const useAppStore = create<AppState>((set, get) => ({
  // Filled during bootstrap before the first render; see main.tsx.
  config: null as unknown as AppConfig,
  view: 'calendar',

  setView: (view) => set({ view }),

  saveConfig: async (config) => {
    const previous = get().config
    set({ config })
    applyTheme(config.themeId)
    if (config.language !== previous.language) {
      await i18n.changeLanguage(config.language)
    }
    return window.api.config.set(config)
  },

  rememberLastUsed: (lastUsed) => {
    const config = { ...get().config, lastUsed }
    set({ config })
    void window.api.config.set(config)
  }
}))
