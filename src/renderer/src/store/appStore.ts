import { create } from 'zustand'
import type {
  AppConfig,
  AutoLoggerPrompt,
  CommitInfo,
  ProjectSelection,
  ProjectSuggestions,
  Result,
  UpdateState
} from '@shared/domain'
import i18n from '@/i18n'
import { applyTheme } from '@/theme/themes'

export type AppView = 'calendar' | 'projects' | 'reports' | 'settings'

/** Statuses that mean an update is worth surfacing (banner + tab badge). */
const NOTIFYING = new Set<UpdateState['status']>([
  'available',
  'downloading',
  'downloaded',
  'error'
])

/**
 * Everything the suggestion wizard holds before the entries reach Tempo. It
 * lives in the store, not in the popup, so closing the popup (or wandering off
 * to another tab) parks the generation instead of throwing it away.
 */
export interface WizardDraft {
  /** Dates the wizard was opened for; also the draft's identity. */
  dates: string[]
  step: 'input' | 'suggestions'
  layout: 'cards' | 'table'
  selections: ProjectSelection[]
  groups: ProjectSuggestions[]
  commitsByProject: Record<string, CommitInfo[]>
  dateFilter: string | null
}

const draftKey = (dates: string[]): string => [...dates].sort().join(',')

/**
 * The draft for exactly these dates, or the one whose run covered them all -
 * clicking a single day of a multi-day generation reopens that generation
 * rather than starting a blank one next to it.
 */
export function findDraft(
  drafts: Record<string, WizardDraft>,
  dates: string[]
): WizardDraft | null {
  const exact = drafts[draftKey(dates)]
  if (exact) return exact
  return (
    Object.values(drafts).find((draft) => dates.every((date) => draft.dates.includes(date))) ?? null
  )
}

interface AppState {
  config: AppConfig
  view: AppView
  /** Month preselected when a reminder opens the Reports tab. */
  reportMonth: string | null
  /** Day the scheduler wants opened, and whether to generate right away. */
  autoLoggerPrompt: AutoLoggerPrompt | null
  update: UpdateState | null
  /** True once the user closes the update banner; the tab badge stays. */
  updateBannerDismissed: boolean
  /** Unsubmitted wizard drafts, keyed by their sorted dates. */
  drafts: Record<string, WizardDraft>
  setView(view: AppView): void
  openReports(month?: string): void
  requestAutoLoggerPrompt(prompt: AutoLoggerPrompt): void
  consumeAutoLoggerPrompt(): void
  /** Persists the config and applies theme/language side effects. */
  saveConfig(config: AppConfig): Promise<Result<void>>
  /** Updates lastUsed without any UI side effects. */
  rememberLastUsed(lastUsed: AppConfig['lastUsed']): void
  /** Parks an unsubmitted generation so reopening those days restores it. */
  saveDraft(draft: WizardDraft): void
  /** Drops the draft for these dates (explicit discard, or a done submit). */
  discardDraft(dates: string[]): void
  /** Applies a new updater snapshot; re-shows the banner on a fresh version. */
  setUpdate(update: UpdateState): void
  dismissUpdateBanner(): void
}

export const useAppStore = create<AppState>((set, get) => ({
  // Filled during bootstrap before the first render; see main.tsx.
  config: null as unknown as AppConfig,
  view: 'calendar',
  reportMonth: null,
  autoLoggerPrompt: null,
  update: null,
  updateBannerDismissed: false,
  drafts: {},

  setView: (view) => set({ view, ...(view === 'reports' ? { reportMonth: null } : {}) }),
  openReports: (month) => set({ view: 'reports', reportMonth: month ?? null }),
  requestAutoLoggerPrompt: (prompt) => set({ view: 'calendar', autoLoggerPrompt: prompt }),
  consumeAutoLoggerPrompt: () => set({ autoLoggerPrompt: null }),

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

  saveDraft: (draft) => set({ drafts: { ...get().drafts, [draftKey(draft.dates)]: draft } }),

  discardDraft: (dates) => {
    const drafts = { ...get().drafts }
    delete drafts[draftKey(dates)]
    set({ drafts })
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
