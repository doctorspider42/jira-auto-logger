import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { format, isBefore, isSameMonth, startOfDay } from 'date-fns'
import type { AppConfig } from '@shared/domain'
import { dateLocale, formatHours, toIsoDate } from '@/utils/format'
import { isTruthyAttribute, type CalendarEntry } from './useCalendar'

interface Props {
  config: AppConfig
  month: Date
  days: Date[]
  worklogsByDate: Map<string, CalendarEntry[]>
  onToggleConnection: (id: string) => void
  onFillMissing: (dates: string[]) => void
}

const isWorkday = (d: Date): boolean => d.getDay() !== 0 && d.getDay() !== 6

/**
 * The month at a glance: hours logged, past workdays still empty (with a
 * one-click way to fill them) and the hours carrying each calendar-marked
 * custom field, e.g. overtime.
 */
export function MonthSummary({ config, month, days, worklogsByDate, onToggleConnection, onFillMissing }: Props): JSX.Element {
  const { t } = useTranslation()
  const summary = useMemo(() => {
    const today = startOfDay(new Date())
    const inMonth = days.filter((d) => isSameMonth(d, month))
    const entries = inMonth.flatMap((d) => worklogsByDate.get(toIsoDate(d)) ?? [])
    const missing = inMonth
      .filter((d) => isWorkday(d) && isBefore(d, today) && (worklogsByDate.get(toIsoDate(d)) ?? []).length === 0)
      .map(toIsoDate)
    const marked = config.customFields
      .filter((f) => f.showInCalendar && f.calendarIcon)
      .map((field) => ({
        field,
        seconds: entries
          .filter((e) => e.connectionId === field.connectionId)
          .filter((e) => isTruthyAttribute(field.type, e.attributes.find((a) => a.key === field.key)?.value))
          .reduce((sum, e) => sum + e.timeSpentSeconds, 0)
      }))
      .filter((m) => m.seconds > 0)
    return {
      seconds: entries.reduce((sum, e) => sum + e.timeSpentSeconds, 0),
      missing,
      marked
    }
  }, [config.customFields, days, month, worklogsByDate])

  const monthName = format(month, 'LLLL', { locale: dateLocale(config.language) })

  return (
    <section className="month-summary" aria-label={t('calendar.summaryLabel')}>
      <div className="month-summary-stat">
        <span className="mono month-summary-big">
          {formatHours(summary.seconds)}
          {t('app.hoursShort')}
        </span>
        <span className="muted">{t('calendar.loggedIn', { month: monthName })}</span>
      </div>
      {summary.missing.length > 0 && (
        <div className="month-summary-stat">
          <span className="dot dot-danger" />
          <span>
            <b>{summary.missing.length}</b>{' '}
            <span className="muted">{t('calendar.missingDays', { count: summary.missing.length })}</span>
          </span>
        </div>
      )}
      {summary.marked.map(({ field, seconds }) => (
        <div key={field.id} className="month-summary-stat">
          <span aria-hidden>{field.calendarIcon}</span>
          <span>
            <b className="mono">
              {formatHours(seconds)}
              {t('app.hoursShort')}
            </b>{' '}
            <span className="muted">{field.label}</span>
          </span>
        </div>
      ))}
      <div className="spacer" />
      {config.connections.length > 1 && (
        <div className="chip-list" role="group" aria-label={t('calendar.activeConnections')}>
          {config.connections.map((connection) => {
            const active = config.activeConnectionIds.includes(connection.id)
            return (
              <button
                key={connection.id}
                className={`chip ${active ? 'selected' : ''}`}
                aria-pressed={active}
                onClick={() => onToggleConnection(connection.id)}
              >
                <span className="chip-dot" style={{ background: active ? 'var(--ink)' : 'var(--line)' }} />
                {connection.name || connection.jira.baseUrl}
              </button>
            )
          })}
        </div>
      )}
      {summary.missing.length > 0 && (
        <button className="btn btn-sm month-summary-fill" onClick={() => onFillMissing(summary.missing)}>
          {t('calendar.fillMissing', { count: summary.missing.length })}
        </button>
      )}
    </section>
  )
}
