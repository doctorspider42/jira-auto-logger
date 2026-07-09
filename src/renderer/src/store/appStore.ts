import { create } from 'zustand'
import type { AppConfig, Result, UpdateState } from '@shared/domain'
import i18n from '@/i18n'
import { applyTheme } from '@/theme/themes'

export type AppView = 'calendar' | 'projects' | 'settings'

/** Statuses that mean an update is worth surfacing (banner + tab badge). */
const NOTIFYING = new Set<UpdateState['status']>([
  'available',
  'downloading',
  'downloaded',
  'error'
])

interface AppState {
  config: AppConfig
  view: AppView
  update: UpdateState | null
  /** True once the user closes the update banner; the tab badge stays. */
  updateBannerDismissed: boolean
  setView(view: AppView): void
  /** Persists the config and applies theme/language side effects. */
  saveConfig(config: AppConfig): Promise<Result<void>>
  /** Updates lastUsed without any UI side effects. */
  rememberLastUsed(lastUsed: AppConfig['lastUsed']): void
  /** Applies a new updater snapshot; re-shows the banner on a fresh version. */
  setUpdate(update: UpdateState): void
  dismissUpdateBanner(): void
}

export const useAppStore = create<AppState>((set, get) => ({
  // Filled during bootstrap before the first render; see main.tsx.
  config: null as unknown as AppConfig,
  view: 'calendar',
  update: null,
  updateBannerDismissed: false,

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
  },

  setUpdate: (update) => {
    const previous = get().update
    // A newer version appearing (or a download finishing) re-opens the banner
    // even if the user dismissed the earlier notification.
    const changedVersion = update.availableVersion !== previous?.availableVersion
    const becameDownloaded = update.status === 'downloaded' && previous?.status !== 'downloaded'
    set({
      update,
      updateBannerDismissed:
        changedVersion || becameDownloaded ? false : get().updateBannerDismissed
    })
  },

  dismissUpdateBanner: () => set({ updateBannerDismissed: true })
}))

export { NOTIFYING as UPDATE_NOTIFYING_STATUSES }
