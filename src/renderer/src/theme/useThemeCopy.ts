import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/appStore'
import { THEMES, type ThemeCopy } from './themes'

/** `copy` of the theme currently applied, if it declares any. */
export function useThemeCopy(): ThemeCopy | undefined {
  const themeId = useAppStore((s) => s.config.themeId)
  return THEMES.find((theme) => theme.id === themeId)?.copy
}

/**
 * Like `t`, but a key the active theme reworded resolves to the theme's version.
 * Use it for labels a theme is allowed to speak in its own voice; plain `t`
 * stays right for everything else.
 */
export function useThemeText(): (key: string, options?: Record<string, unknown>) => string {
  const { t } = useTranslation()
  const copy = useThemeCopy()
  // i18next takes a key list and returns the first one that exists, so the
  // theme's subtree is simply tried before the root key.
  return (key, options) => t(copy ? [`${copy.key}.${key}`, key] : key, options) as string
}

/**
 * Loading messages for the active theme: the shared pool, extended by or
 * replaced with the theme's own, depending on what the theme declared.
 */
export function useLoadingMessages(): string[] {
  const { t } = useTranslation()
  const copy = useThemeCopy()
  const shared = t('funnyLoading', { returnObjects: true }) as string[]
  if (!copy?.loadingMessages) return shared

  const themed = t(`${copy.key}.funnyLoading`, { returnObjects: true, defaultValue: [] }) as
    | string[]
    | string
  // A theme that declares a mode but ships no messages (or only a stray string
  // from a half-translated locale) must not empty the loader.
  if (!Array.isArray(themed) || themed.length === 0) return shared
  return copy.loadingMessages === 'replace' ? themed : [...shared, ...themed]
}
