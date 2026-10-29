import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, format, isToday, parseISO, startOfWeek } from 'date-fns'
import type { AppConfig, AppError, CommitInfo, NewWorklog } from '@shared/domain'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { Icon } from '@/components/common/Icon'
import { dateLocale, formatHours, toIsoDate } from '@/utils/format'
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
  onSelectDay: (date: Date) => void
  /** Reloads the calendar after the panel logged time itself. */
  onLogged: () => void
}

/** How many recent issues the quick-add row offers. */
const QUICK_ISSUES = 4
/** How many of the day's commits the panel lists. */
const COMMITS_SHOWN = 3

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

/** A worklog to recreate on another day, keeping its issue, text and fields. */
function copyOf(entry: CalendarEntry, date: string, seconds = entry.timeSpentSeconds): NewWorklog {
  return {
    issueKey: entry.issueKey,
    description: entry.description,
    timeSpentSeconds: seconds,
    startDate: date,
    attributes: entry.attributes
  }
}

/**
 * The panel beside the calendar. For a day with entries: what it holds and how
 * it splits across projects. For an empty day: what could fill it - the day's
 * commits, last week's same day to copy, recent issues to add an hour to.
 * Always: the week around it. A dragged range sums the days instead.
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
  onCollapse,
  onSelectDay,
  onLogged
}: Props): JSX.Element {
  const { t } = useTranslation()
  const locale = dateLocale(config.language)
  const entries = dates.flatMap((d) => worklogsByDate.get(d) ?? [])
  const total = entries.reduce((sum, e) => sum + e.timeSpentSeconds, 0)
  const hasDraft = dates.some((d) => draftDates.has(d))
  const suggestLabel = hasDraft ? t('calendar.openDraft') : t('calendar.generateSuggestions')
  const single = dates.length === 1
  const iso = dates[0]
  const day = parseISO(iso)
  const workday = config.workingHoursPerDay * 3600
  /**
   * A day's target: the working day once per Jira it is logged to, since a
   * project mirrored into two Jiras logs a full day in each.
   */
  const targetOf = (dayIso: string): number =>
    workday * Math.max(1, new Set((worklogsByDate.get(dayIso) ?? []).map((e) => e.connectionId)).size)
  const target = targetOf(iso)
  const empty = single && entries.length === 0

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [commits, setCommits] = useState<CommitInfo[] | null>(null)

  // The day's commits, only for an empty day - that is when they help decide.
  const folders = useMemo(
    () => [
      ...new Set(config.projects.filter((p) => !p.archived).flatMap((p) => p.gitFolders.map((f) => f.path)))
    ],
    [config.projects]
  )
  useEffect(() => {
    setCommits(null)
    setError(null)
    if (!empty || folders.length === 0) return
    let cancelled = false
    void window.api.git.getCommits(folders, [iso]).then((result) => {
      if (!cancelled) setCommits(result.ok ? result.value : [])
    })
    return () => {
      cancelled = true
    }
  }, [empty, iso, folders])

  /** Logs worklogs grouped per Jira, then refreshes the calendar. */
  const log = async (key: string, worklogs: Array<{ connectionId: string; worklog: NewWorklog }>): Promise<void> => {
    setBusy(key)
    setError(null)
    const byConnection = new Map<string, NewWorklog[]>()
    for (const { connectionId, worklog } of worklogs) {
      byConnection.set(connectionId, [...(byConnection.get(connectionId) ?? []), worklog])
    }
    for (const [connectionId, list] of byConnection) {
      const result = await window.api.tempo.createWorklogs(connectionId, list)
      if (!result.ok) {
        setError(result.error)
        setBusy(null)
        return
      }
    }
    setBusy(null)
    onLogged()
  }

  const lastWeekIso = toIsoDate(addDays(day, -7))
  const lastWeek = worklogsByDate.get(lastWeekIso) ?? []

  /** Issues logged most recently, newest first, one per issue and Jira. */
  const recentIssues = useMemo(() => {
    const all = [...worklogsByDate.values()].flat().sort((a, b) => b.startDate.localeCompare(a.startDate))
    const seen = new Set<string>()
    const recent: CalendarEntry[] = []
    for (const entry of all) {
      const key = `${entry.connectionId}|${entry.issueKey}`
      if (seen.has(key)) continue
      seen.add(key)
      recent.push(entry)
      if (recent.length === QUICK_ISSUES) break
    }
    return recent
  }, [worklogsByDate])

  // The week around the day, as small bars against the working day.
  const weekStart = startOfWeek(day, { weekStartsOn: 1 })
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter(
    (d) => config.showWeekends || (d.getDay() !== 0 && d.getDay() !== 6)
  )
  const weekTotal = week.reduce(
    (sum, d) => sum + (worklogsByDate.get(toIsoDate(d)) ?? []).reduce((s, e) => s + e.timeSpentSeconds, 0),
    0
  )
  const weekTarget = week
    .filter((d) => d.getDay() !== 0 && d.getDay() !== 6)
    .reduce((sum, d) => sum + targetOf(toIsoDate(d)), 0)

  const weekBlock = (
    <section className="inspector-section inspector-week">
      <div className="inspector-section-head">
        <h3>{t('calendar.thisWeek')}</h3>
        <span className="mono">
          {formatHours(weekTotal)}
          {t('app.hoursShort')}{' '}
          <span className="muted">
            / {formatHours(weekTarget)}
            {t('app.hoursShort')}
          </span>
        </span>
      </div>
      <div className="inspector-week-bars">
        {week.map((d) => {
          const dIso = toIsoDate(d)
          const seconds = (worklogsByDate.get(dIso) ?? []).reduce((s, e) => s + e.timeSpentSeconds, 0)
          const dayTarget = targetOf(dIso)
          const state = seconds >= dayTarget ? 'full' : seconds > 0 ? 'partial' : 'none'
          return (
            <button
              key={dIso}
              className={`inspector-week-day ${dates.includes(dIso) ? 'selected' : ''} ${isToday(d) ? 'today' : ''}`}
              onClick={() => onSelectDay(d)}
              title={`${format(d, 'EEEE d MMM', { locale })}: ${formatHours(seconds)}${t('app.hoursShort')}`}
            >
              <span className="inspector-week-track">
                <span className={state} style={{ height: `${Math.max(4, Math.min(100, (seconds / dayTarget) * 100))}%` }} />
              </span>
              <span className="inspector-week-label">{format(d, 'EEEEEE', { locale })}</span>
            </button>
          )
        })}
      </div>
    </section>
  )

  if (!single) {
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

  // Hours per project, for the split bar.
  const byProject = new Map<string, { name: string; color: string; seconds: number }>()
  for (const entry of entries) {
    const name = entry.projectName || entry.connectionName
    const current = byProject.get(name) ?? { name, color: entry.projectColor || 'var(--muted)', seconds: 0 }
    current.seconds += entry.timeSpentSeconds
    byProject.set(name, current)
  }
  const split = [...byProject.values()].sort((a, b) => b.seconds - a.seconds)
  const shownCommits = (commits ?? []).slice(0, COMMITS_SHOWN)

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
            <span className="muted">
              {' '}
              / {formatHours(target)}
              {t('app.hoursShort')}
            </span>
          </span>
        </div>
        <span className="meter inspector-progress" aria-hidden>
          <span
            className={total >= target ? '' : 'partial'}
            style={{ width: `${Math.min(100, (total / target) * 100)}%` }}
          />
        </span>
      </div>

      {error && <ErrorBanner error={error} />}

      {empty ? (
        <>
          <section className="inspector-section">
            {shownCommits.length > 0 && (
              <>
                <h3>
                  <Icon name="branch" size={14} />
                  {t('calendar.commitsThatDay')}
                </h3>
                <ul className="inspector-commits">
                  {shownCommits.map((commit) => (
                    <li key={commit.hash} title={commit.message}>
                      <span className="mono inspector-commit-repo">{commit.repoLabel}</span>
                      <span className="inspector-commit-text">{commit.message.split('\n')[0]}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {commits && commits.length === 0 && folders.length > 0 && (
              <p className="muted inspector-note">{t('calendar.noCommits')}</p>
            )}
            <button className="btn btn-primary btn-lg" onClick={() => onSuggest(dates)}>
              {shownCommits.length > 0 && !hasDraft ? t('calendar.suggestFromCommits') : suggestLabel}
            </button>
          </section>

          {lastWeek.length > 0 && (
            <section className="inspector-section">
              <h3>
                <Icon name="history" size={14} />
                {t('calendar.sameAsLastWeek', { weekday: format(day, 'EEEE', { locale }) })}
              </h3>
              <ul className="inspector-mini-list">
                {lastWeek.map((entry) => (
                  <li key={`${entry.connectionId}-${entry.tempoWorklogId}`} title={entry.description}>
                    <span className="chip-dot" style={{ background: entry.projectColor || 'var(--muted)' }} />
                    <span className="mono">{entry.issueKey}</span>
                    <span className="muted inspector-mini-text">{entry.description || entry.issueSummary}</span>
                    <span className="mono">
                      {formatHours(entry.timeSpentSeconds)}
                      {t('app.hoursShort')}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                className="btn"
                disabled={busy !== null}
                onClick={() =>
                  void log(
                    'copy',
                    lastWeek.map((entry) => ({ connectionId: entry.connectionId, worklog: copyOf(entry, iso) }))
                  )
                }
              >
                {busy === 'copy' && <span className="spinner" />}
                {t('calendar.copyToDay', { day: format(day, 'd MMMM', { locale }) })}
              </button>
            </section>
          )}

          {recentIssues.length > 0 && (
            <section className="inspector-section">
              <h3>{t('calendar.quickAdd')}</h3>
              <div className="chip-list">
                {recentIssues.map((entry) => {
                  const key = `${entry.connectionId}|${entry.issueKey}`
                  return (
                    <button
                      key={key}
                      className="chip"
                      disabled={busy !== null}
                      title={t('calendar.quickAddHint', { issue: entry.issueSummary || entry.issueKey })}
                      onClick={() =>
                        void log(key, [{ connectionId: entry.connectionId, worklog: copyOf(entry, iso, 3600) }])
                      }
                    >
                      {busy === key ? (
                        <span className="spinner" />
                      ) : (
                        <span className="chip-dot" style={{ background: entry.projectColor || 'var(--muted)' }} />
                      )}
                      <span className="mono">{entry.issueKey}</span>
                      <span className="muted">+1{t('app.hoursShort')}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
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
          {split.length > 1 && (
            <section className="inspector-section">
              <h3>{t('calendar.splitByProject')}</h3>
              <div className="inspector-split-bar" aria-hidden>
                {split.map((part) => (
                  <span key={part.name} style={{ flex: part.seconds, background: part.color }} />
                ))}
              </div>
              <div className="inspector-split-legend">
                {split.map((part) => (
                  <span key={part.name}>
                    <span className="chip-dot" style={{ background: part.color }} />
                    {part.name}{' '}
                    <span className="mono">
                      {formatHours(part.seconds)}
                      {t('app.hoursShort')}
                    </span>
                  </span>
                ))}
              </div>
            </section>
          )}
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

      {weekBlock}
    </aside>
  )
}
