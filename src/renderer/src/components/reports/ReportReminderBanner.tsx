import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReportReminder } from '@shared/domain'
import { useAppStore } from '@/store/appStore'

export function ReportReminderBanner(): JSX.Element | null {
  const { t } = useTranslation()
  const config = useAppStore((state) => state.config)
  const openReports = useAppStore((state) => state.openReports)
  const [reminder, setReminder] = useState<ReportReminder | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const refresh = useCallback((): void => {
    void window.api.reports.getReminder().then((next) => {
      setReminder(next)
      if (!next.month) setDismissed(false)
    })
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('reports-generated', refresh)
    return () => window.removeEventListener('reports-generated', refresh)
  }, [refresh, config.reports])

  if (!reminder?.month || dismissed) return null

  return (
    <div className="banner banner-report">
      <span className="banner-report-icon">PDF</span>
      <span className="banner-report-copy">
        <strong>{t('reports.reminderTitle')}</strong>
        {t('reports.reminderText', { month: reminder.month })}
      </span>
      <button className="btn btn-sm" onClick={() => openReports(reminder.month!)}>
        {t('reports.generateNow')}
      </button>
      <button className="btn btn-sm btn-ghost" onClick={() => setDismissed(true)}>
        {t('reports.later')}
      </button>
    </div>
  )
}
