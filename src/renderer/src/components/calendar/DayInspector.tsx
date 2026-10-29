import { useTranslation } from 'react-i18next'
import { format, isToday, parseISO } from 'date-fns'
import type { AppConfig } from '@shared/domain'
import { Icon } from '@/components/common/Icon'
import { dateLocale, formatHours } from '@/utils/format'
import type { CalendarEntry } from './useCalendar'

interface Props {
  config: AppConfig
  /** Selected ISO dates, sorted; one day or a dragged range. */
  dates: string[]
  worklogsByDate: Map<string, CalendarEntry[]>
  draftDates: Set<string>
  onSuggest: (dates: string[]) => void
  onOpenDay: (date: Date) => void
  onEditEntry: (entry: CalendarEntry) => void
  onClearSelection: () => void
  /** Folds the panel into a strip beside the calendar. */
  onCollapse: () => void
}

/** The eyebrow line with the button that folds the panel away. */
function PanelHead({ label, onCollapse }: { label: string; onCollapse: () => void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="inspector-head">
      <div className="eyebrow">{label}</div>
      <button
        className="btn btn-ghost btn-icon btn-sm inspector-toggle"
        onClick={onCollapse}
        aria-label={t('calendar.hidePanel')}
        title={`${t('calendar.hidePanel')} (Ctrl+B)`}
      >
        <Icon name="panelHide" />
      </button>
    </div>
  )
}

interface StripProps {
  /** Short title of what the panel shows: a day or a range. */
  title: string
  totalSeconds: number
  entries: CalendarEntry[]
  onExpand: () => void
}

/** The folded panel: a narrow strip with the day, its total and a dot per entry. */
export function DayInspectorStrip({ title, totalSeconds, entries, onExpand }: StripProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <aside className="inspector-strip" aria-label={t('calendar.selection')}>
      <button
        className="btn btn-ghost btn-icon btn-sm"
        onClick={onExpand}
        aria-label={t('calendar.showPanel')}
        title={`${t('calendar.showPanel')} (Ctrl+B)`}
      >
        <Icon name="panelShow" />
      </button>
      <button className="inspector-strip-title" onClick={onExpand}>
        {title}
      </button>
      <span className="mono muted inspector-strip-total">
        {formatHours(totalSeconds)}
        {t('app.hoursShort')}
      </span>
      {entries.slice(0, 12).map((entry) => (
        <span
          key={`${entry.connectionId}-${entry.tempoWorklogId}`}
          className="inspector-strip-dot"
          style={{ background: entry.projectColor || 'var(--muted)' }}
          title={`${entry.issueKey} · ${formatHours(entry.timeSpentSeconds)}${t('app.hoursShort')}`}
        />
      ))}
    </aside>
  )
}

/**
 * The panel beside the calendar: what the selected day holds - hours per Jira
 * against the working day, every entry - and the way to add more. With a
 * dragged range it sums the days and offers suggestions for all of them.
 */
export function DayInspector({
  config,
  dates,
  worklogsByDate,
  draftDates,
  onSuggest,
  onOpenDay,
  onEditEntry,
  onClearSelection,
  onCollapse
}: Props): JSX.Element {
  const { t } = useTranslation()
  const locale = dateLocale(config.language)
  const entries = dates.flatMap((d) => worklogsByDate.get(d) ?? [])
  const total = entries.reduce((sum, e) => sum + e.timeSpentSeconds, 0)
  const hasDraft = dates.some((d) => draftDates.has(d))
  const suggestLabel = hasDraft ? t('calendar.openDraft') : t('calendar.generateSuggestions')

  if (dates.length > 1) {
    const first = parseISO(dates[0])
    const last = parseISO(dates[dates.length - 1])
    return (
      <aside className="inspector" aria-label={t('calendar.selection')}>
        <div>
          <PanelHead label={t('calendar.selectedDays', { count: dates.length })} onCollapse={onCollapse} />
          <div className="inspector-title-row">
            <h2 className="inspector-title">
              {format(first, 'd MMM', { locale })} – {format(last, 'd MMM', { locale })}
            </h2>
            <span className="mono inspector-total">
              {formatHours(total)}
              {t('app.hoursShort')}
            </span>
          </div>
        </div>
        <div className="inspector-actions">
          <button className="btn btn-primary btn-lg" onClick={() => onSuggest(dates)}>
            {suggestLabel}
          </button>
          <button className="btn btn-lg" onClick={onClearSelection}>
            {t('calendar.clearSelection')}
          </button>
        </div>
      </aside>
    )
  }

  const day = parseISO(dates[0])
  const connections = config.connections
    .map((connection) => ({
      connection,
      seconds: entries.filter((e) => e.connectionId === connection.id).reduce((sum, e) => sum + e.timeSpentSeconds, 0)
    }))
    .filter((c) => c.seconds > 0)
  const target = config.workingHoursPerDay * 3600

  return (
    <aside className="inspector" aria-label={t('calendar.selection')}>
      <div>
        <PanelHead
          label={`${format(day, 'EEEE', { locale })}${isToday(day) ? ` · ${t('calendar.today')}` : ''}`}
          onCollapse={onCollapse}
        />
        <div className="inspector-title-row">
          <h2 className="inspector-title">{format(day, 'd MMMM', { locale })}</h2>
          <span className="mono inspector-total">
            {formatHours(total)}
            {t('app.hoursShort')}
          </span>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="inspector-empty">
          <p className="muted">{t('calendar.inspectorEmpty')}</p>
          <button className="btn btn-primary btn-lg" onClick={() => onSuggest(dates)}>
            {suggestLabel}
          </button>
        </div>
      ) : (
        <>
          {connections.length > 1 && (
            <div className="inspector-split">
              {connections.map(({ connection, seconds }) => (
                <div key={connection.id} className="inspector-split-row">
                  <span className="inspector-split-name">{connection.name || connection.jira.baseUrl}</span>
                  <span className="meter" aria-hidden>
                    <span style={{ width: `${Math.min(100, (seconds / target) * 100)}%` }} />
                  </span>
                  <span className="mono">
                    {formatHours(seconds)}
                    {t('app.hoursShort')}
                  </span>
                </div>
              ))}
            </div>
          )}
          <ul className="inspector-entries">
            {entries.map((entry) => (
              <li key={`${entry.connectionId}-${entry.tempoWorklogId}`}>
                <button className="inspector-entry" onClick={() => onEditEntry(entry)} title={t('calendar.editor.editHint')}>
                  <span className="inspector-entry-bar" style={{ background: entry.projectColor || 'var(--line)' }} />
                  <span className="inspector-entry-body">
                    <span className="inspector-entry-meta">
                      <span className="mono">{entry.issueKey}</span>
                      {config.connections.length > 1 && <span className="muted">{entry.connectionName}</span>}
                      {entry.fieldIcons.length > 0 && <span aria-hidden>{entry.fieldIcons.join('')}</span>}
                    </span>
                    <span className="inspector-entry-title">{entry.description || entry.issueSummary}</span>
                  </span>
                  <span className="mono">
                    {formatHours(entry.timeSpentSeconds)}
                    {t('app.hoursShort')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="inspector-actions inspector-actions-row">
            <button className="btn" onClick={() => onOpenDay(day)}>
              {t('calendar.openDayShort')}
            </button>
            <button className="btn" onClick={() => onSuggest(dates)}>
              {suggestLabel}
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
