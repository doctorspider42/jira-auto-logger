import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/appStore'

/**
 * Header affordance to check for updates from anywhere in the app (the same
 * check also lives in Settings). A found update surfaces via the UpdateBanner;
 * here we only need to reflect the in-flight state and confirm "up to date"
 * for a check the user just triggered.
 */
export function UpdateCheckButton(): JSX.Element {
  const { t } = useTranslation()
  const status = useAppStore((s) => s.update?.status)
  const [requested, setRequested] = useState(false)

  const checking = status === 'checking'
  // Only report "up to date" for a check initiated from this button.
  const upToDate = requested && status === 'not-available'

  useEffect(() => {
    if (!upToDate) return
    const timer = setTimeout(() => setRequested(false), 4000)
    return () => clearTimeout(timer)
  }, [upToDate])

  const check = (): void => {
    setRequested(true)
    void window.api.updates.check()
  }

  return (
    <div className="update-check">
      {upToDate && <span className="hint">{t('updates.statusUpToDate')}</span>}
      <button
        className="btn btn-ghost btn-sm"
        onClick={check}
        disabled={checking}
        title={t('updates.checkNow')}
      >
        {checking ? <span className="spinner" /> : '↻'} {t('updates.checkNow')}
      </button>
    </div>
  )
}
