import { useTranslation } from 'react-i18next'
import { useAppStore, UPDATE_NOTIFYING_STATUSES } from '@/store/appStore'
import { openExternal } from '@/utils/external'

/**
 * Top-of-app notification about a new release. On auto-updatable platforms it
 * offers download/restart actions; on unsigned macOS builds it links to the
 * GitHub releases page for a manual download. Dismissing hides the banner but
 * leaves the Settings-tab badge (see App), so the update is never lost.
 */
export function UpdateBanner(): JSX.Element | null {
  const { t } = useTranslation()
  const update = useAppStore((s) => s.update)
  const dismissed = useAppStore((s) => s.updateBannerDismissed)
  const dismiss = useAppStore((s) => s.dismissUpdateBanner)

  if (!update || dismissed || !UPDATE_NOTIFYING_STATUSES.has(update.status)) return null
  const { status, availableVersion, progressPercent, releaseUrl, canAutoUpdate } = update

  const dismissButton = (
    <button className="btn btn-sm btn-ghost" onClick={dismiss}>
      {t('updates.later')}
    </button>
  )

  return (
    <div className="banner banner-update" role="status">
      {status === 'available' && (
        <>
          <span style={{ flex: 1 }}>{t('updates.available', { version: availableVersion })}</span>
          {canAutoUpdate ? (
            <button className="btn btn-sm" onClick={() => void window.api.updates.download()}>
              {t('updates.download')}
            </button>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => releaseUrl && openExternal(releaseUrl)}
            >
              {t('updates.openReleasePage')}
            </button>
          )}
          {dismissButton}
        </>
      )}

      {status === 'downloading' && (
        <>
          <span className="spinner" />
          <span style={{ flex: 1 }}>{t('updates.downloading', { percent: progressPercent })}</span>
          {dismissButton}
        </>
      )}

      {status === 'downloaded' && (
        <>
          <span style={{ flex: 1 }}>{t('updates.ready', { version: availableVersion })}</span>
          <button className="btn btn-sm" onClick={() => void window.api.updates.quitAndInstall()}>
            {t('updates.restart')}
          </button>
          {dismissButton}
        </>
      )}
    </div>
  )
}
