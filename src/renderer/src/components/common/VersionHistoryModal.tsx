import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReleaseNote } from '@shared/domain'
import { useAppStore } from '@/store/appStore'
import { openExternal } from '@/utils/external'
import { renderMarkdown } from '@/utils/markdown'
import { Modal } from './Modal'

const RELEASES_URL = 'https://github.com/doctorspider42/jira-auto-logger/releases'

/**
 * Shows the published release notes fetched from GitHub: the newest release
 * (the "what's new" for an available update) plus the full version history.
 * The currently-installed version is marked and, when an update is pending,
 * that version is emphasized.
 */
export function VersionHistoryModal({ onClose }: { onClose: () => void }): JSX.Element {
  const { t, i18n } = useTranslation()
  const currentVersion = useAppStore((s) => s.update?.currentVersion)
  const availableVersion = useAppStore((s) => s.update?.availableVersion)
  const [releases, setReleases] = useState<ReleaseNote[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void window.api.updates.getReleaseHistory().then((result) => {
      if (!active) return
      if (result.ok) setReleases(result.value)
      else setFailed(true)
    })
    return () => {
      active = false
    }
  }, [])

  const formatDate = (iso: string): string => {
    if (!iso) return ''
    const date = new Date(iso)
    return isNaN(date.getTime()) ? '' : date.toLocaleDateString(i18n.language)
  }

  return (
    <Modal title={t('versionHistory.title')} onClose={onClose}>
      {releases === null && !failed && (
        <div className="version-history-status">
          <span className="spinner" /> {t('versionHistory.loading')}
        </div>
      )}

      {failed && (
        <div className="version-history-status">
          <p>{t('versionHistory.error')}</p>
          <button className="btn btn-sm" onClick={() => openExternal(RELEASES_URL)}>
            {t('updates.openReleasePage')}
          </button>
        </div>
      )}

      {releases !== null && releases.length === 0 && (
        <p className="version-history-status">{t('versionHistory.empty')}</p>
      )}

      {releases?.map((release) => {
        const isCurrent = release.version === currentVersion
        const isAvailable = !!availableVersion && release.version === availableVersion
        return (
          <section
            key={release.version || release.name}
            className={`release-note${isAvailable ? ' release-note-available' : ''}`}
          >
            <header className="release-note-header">
              <h3>
                {release.name || release.version}
                {release.prerelease && (
                  <span className="release-tag">{t('versionHistory.prerelease')}</span>
                )}
                {isCurrent && (
                  <span className="release-tag release-tag-current">
                    {t('versionHistory.installed')}
                  </span>
                )}
                {isAvailable && (
                  <span className="release-tag release-tag-new">{t('versionHistory.new')}</span>
                )}
              </h3>
              <div className="release-note-meta">
                {formatDate(release.publishedAt) && <span>{formatDate(release.publishedAt)}</span>}
                <a
                  href={release.url}
                  onClick={(e) => {
                    e.preventDefault()
                    openExternal(release.url)
                  }}
                >
                  {t('versionHistory.viewOnGithub')} ↗
                </a>
              </div>
            </header>
            {release.notes ? (
              renderMarkdown(release.notes)
            ) : (
              <p className="hint">{t('versionHistory.noNotes')}</p>
            )}
          </section>
        )
      })}
    </Modal>
  )
}
