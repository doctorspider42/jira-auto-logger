import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format, isSameMonth, isToday } from 'date-fns'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { SuggestionWizard } from '@/components/wizard/SuggestionWizard'
import { useAppStore } from '@/store/appStore'
import { dateLocale, formatHours, toIsoDate } from '@/utils/format'
import { useCalendar } from './useCalendar'
import './calendar.css'

export function CalendarView(): JSX.Element {
  const { t } = useTranslation()
  const config = useAppStore((s) => s.config)
  const saveConfig = useAppStore((s) => s.saveConfig)
  const language = config.language
  const [wizardDates, setWizardDates] = useState<string[] | null>(null)
  const openWizard = useCallback((dates: string[]) => setWizardDates(dates), [])
  const calendar = useCalendar(openWizard)

  const toggleConnection = (id: string): void => {
    const active = config.activeConnectionIds.includes(id)
      ? config.activeConnectionIds.filter((a) => a !== id)
      : [...config.activeConnectionIds, id]
    void saveConfig({ ...config, activeConnectionIds: active })
  }

  const multipleActive = config.activeConnectionIds.length > 1

  const weekdays = t('calendar.weekdays', { returnObjects: true }) as string[]
  const monthLabel = format(calendar.month, 'LLLL yyyy', { locale: dateLocale(language) })
  const selectedDates = [...calendar.selected].sort()

  const onWizardDone = (): void => {
    setWizardDates(null)
    calendar.clearSelection()
    calendar.reload()
  }

  return (
    <div className="calendar">
      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button className="btn btn-sm" onClick={() => calendar.goToMonth(-1)} aria-label="previous month">
            ‹
          </button>
          <span className="calendar-month-label">{monthLabel}</span>
          <button className="btn btn-sm" onClick={() => calendar.goToMonth(1)} aria-label="next month">
            ›
          </button>
          <button className="btn btn-ghost btn-sm" onClick={calendar.goToToday}>
            {t('calendar.today')}
          </button>
          {calendar.loading && <span className="spinner" />}
        </div>
        {config.connections.length > 1 && (
          <div className="chip-list" title={t('calendar.activeConnections')}>
            {config.connections.map((connection) => (
              <button
                key={connection.id}
                className={`chip ${config.activeConnectionIds.includes(connection.id) ? 'selected' : ''}`}
                onClick={() => toggleConnection(connection.id)}
              >
                {connection.name || connection.jira.baseUrl}
              </button>
            ))}
          </div>
        )}
        <div className="calendar-actions">
          {calendar.selected.size > 1 && (
            <>
              <span className="hint">{t('calendar.selectedDays', { count: calendar.selected.size })}</span>
              <button className="btn btn-ghost btn-sm" onClick={calendar.clearSelection}>
                {t('calendar.clearSelection')}
              </button>
              <button className="btn btn-primary" onClick={() => setWizardDates(selectedDates)}>
                {t('calendar.generateSuggestions')}
              </button>
            </>
          )}
        </div>
      </div>

      {calendar.error && <ErrorBanner error={calendar.error} onRetry={calendar.reload} />}
      {calendar.selected.size <= 1 && <p className="hint calendar-hint">{t('calendar.selectHint')}</p>}

      <div className="calendar-grid" role="grid">
        {weekdays.map((day) => (
          <div key={day} className="calendar-weekday">
            {day}
          </div>
        ))}
        {calendar.days.map((day) => {
          const iso = toIsoDate(day)
          const worklogs = calendar.worklogsByDate.get(iso) ?? []
          const totalSeconds = worklogs.reduce((sum, w) => sum + w.timeSpentSeconds, 0)
          const isWeekend = day.getDay() === 0 || day.getDay() === 6
          const classes = [
            'calendar-day',
            !isSameMonth(day, calendar.month) && 'outside',
            isWeekend && 'weekend',
            isToday(day) && 'today',
            calendar.selected.has(iso) && 'selected'
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <div
              key={iso}
              className={classes}
              role="gridcell"
              onMouseDown={(e) => e.button === 0 && calendar.onDayMouseDown(day)}
              onMouseEnter={() => calendar.onDayMouseEnter(day)}
            >
              <div className="calendar-day-head">
                <span className="calendar-day-number">{day.getDate()}</span>
                {totalSeconds > 0 && (
                  <span className="calendar-day-total">
                    {formatHours(totalSeconds)}{t('app.hoursShort')}
                  </span>
                )}
              </div>
              <div className="calendar-day-entries">
                {worklogs.map((worklog) => (
                  <div
                    key={`${worklog.connectionId}-${worklog.tempoWorklogId}`}
                    className="calendar-entry"
                    style={
                      worklog.projectColor
                        ? ({ '--entry-color': worklog.projectColor } as React.CSSProperties)
                        : undefined
                    }
                    title={`[${worklog.projectName || worklog.connectionName}] ${worklog.issueKey} ${worklog.issueSummary}\n${worklog.description}`}
                  >
                    <span className="calendar-entry-key">
                      {multipleActive && (
                        <span className="calendar-entry-conn">
                          {(worklog.connectionName || '?').charAt(0).toUpperCase()}
                        </span>
                      )}
                      {worklog.issueKey}
                    </span>
                    <span className="calendar-entry-hours">
                      {worklog.fieldIcons.length > 0 && (
                        <span className="calendar-entry-icons">{worklog.fieldIcons.join('')}</span>
                      )}
                      {formatHours(worklog.timeSpentSeconds)}{t('app.hoursShort')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {wizardDates && (
        <SuggestionWizard dates={wizardDates} onClose={() => setWizardDates(null)} onDone={onWizardDone} />
      )}
    </div>
  )
}
