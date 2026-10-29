import { useTranslation } from 'react-i18next'
import { format, isToday } from 'date-fns'
import { Icon } from '@/components/common/Icon'
import { dateLocale, formatHours, toIsoDate } from '@/utils/format'
import type { CalendarEntry } from './useCalendar'

interface Props {
  /** The week's days, weekends already dropped when they are hidden. */
  days: Date[]
  worklogsByDate: Map<string, CalendarEntry[]>
  selected: Set<string>
  draftDates: Set<string>
  /** Working day in seconds - what a full day's bar measures against. */
  dayTarget: number
  loading: boolean
  onDayMouseDown: (date: Date) => void
  onDayMouseEnter: (date: Date) => void
  onAddEntries: (dates: string[]) => void
  onEditEntry: (entry: CalendarEntry) => void
  /** When set, entries it rejects are dimmed and matches are emphasised. */
  matchEntry?: (entry: CalendarEntry) => boolean
}

/**
 * One column per day with every entry as a card: the room the month tile
 * doesn't have, so a whole week reads without opening each day. Selection
 * works as in the month grid (click, drag), double-click adds entries.
 */
export function WeekView({
  days,
  worklogsByDate,
  selected,
  draftDates,
  dayTarget,
  loading,
  onDayMouseDown,
  onDayMouseEnter,
  onAddEntries,
  onEditEntry,
  matchEntry
}: Props): JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = dateLocale(i18n.language)

  return (
    <div className="week-view" role="grid" style={{ '--week-days': days.length } as React.CSSProperties}>
      {days.map((day) => {
        const iso = toIsoDate(day)
        const entries = worklogsByDate.get(iso) ?? []
        const total = entries.reduce((sum, e) => sum + e.timeSpentSeconds, 0)
        const weekend = day.getDay() === 0 || day.getDay() === 6
        const past = day < new Date() && !isToday(day)
        const missing = !loading && !weekend && past && entries.length === 0
        const classes = [
          'week-day',
          weekend && 'weekend',
          isToday(day) && 'today',
          selected.has(iso) && 'selected'
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <div
            key={iso}
            className={classes}
            role="gridcell"
            aria-selected={selected.has(iso)}
            onMouseDown={(e) => e.button === 0 && onDayMouseDown(day)}
            onMouseEnter={() => onDayMouseEnter(day)}
            onDoubleClick={() => onAddEntries([iso])}
          >
            <div className="week-day-head">
              <span className="week-day-name">{format(day, 'EEE', { locale })}</span>
              <span className="week-day-number">{day.getDate()}</span>
              <span className="spacer" />
              {draftDates.has(iso) && (
                <span className="calendar-day-draft" title={t('calendar.draftPending')}>
                  ✎
                </span>
              )}
              {total > 0 && (
                <span className={`mono week-day-total ${total >= dayTarget ? '' : 'partial'}`}>
                  {formatHours(total)}
                  {t('app.hoursShort')}
                </span>
              )}
            </div>
            <span className="calendar-day-bar week-day-bar" aria-hidden>
              <span
                className={total >= dayTarget ? 'complete' : 'partial'}
                style={{ width: `${Math.min(100, (total / dayTarget) * 100)}%` }}
              />
            </span>

            <div className="week-day-entries">
              {entries.map((entry) => (
                <button
                  key={`${entry.connectionId}-${entry.tempoWorklogId}`}
                  className={`week-entry ${matchEntry ? (matchEntry(entry) ? 'matched' : 'dimmed') : ''}`}
                  style={
                    entry.projectColor
                      ? ({ '--entry-color': entry.projectColor } as React.CSSProperties)
                      : undefined
                  }
                  title={t('calendar.editor.editHint')}
                  // Keep the click from starting a day drag.
                  onMouseDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onClick={() => onEditEntry(entry)}
                >
                  <span className="week-entry-head">
                    <span className="mono week-entry-key">{entry.issueKey}</span>
                    {entry.fieldIcons.length > 0 && (
                      <span className="calendar-entry-icons">{entry.fieldIcons.join('')}</span>
                    )}
                    <span className="mono week-entry-hours">
                      {formatHours(entry.timeSpentSeconds)}
                      {t('app.hoursShort')}
                    </span>
                  </span>
                  <span className="week-entry-text">{entry.description || entry.issueSummary}</span>
                </button>
              ))}
              {missing && <span className="calendar-day-missing">{t('calendar.nothingLogged')}</span>}
            </div>

            <button
              className="btn btn-ghost btn-sm week-day-add"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onAddEntries([iso])}
            >
              <Icon name="plus" size={13} />
              {t('calendar.addShort')}
            </button>
          </div>
        )
      })}
    </div>
  )
}
