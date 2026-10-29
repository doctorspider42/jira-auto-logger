import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, format, isSameMonth, isToday, startOfMonth } from 'date-fns'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { HelpTip } from '@/components/common/HelpTip'
import { NewIssuePanel, type IssueTarget } from '@/components/issues/NewIssuePanel'
import { Icon } from '@/components/common/Icon'
import { SuggestionWizard } from '@/components/wizard/SuggestionWizard'
import { findDraft, useAppStore } from '@/store/appStore'
import { dateLocale, formatHours, toIsoDate } from '@/utils/format'
import { jiraIssueUrl, openExternal } from '@/utils/external'
import { DayInspector, DayInspectorStrip } from './DayInspector'
import { DayView } from './DayView'
import { EntryEditor } from './EntryEditor'
import { MonthDayEntries } from './MonthDayEntries'
import { MonthSummary } from './MonthSummary'
import { useCalendar, type CalendarEntry } from './useCalendar'
import { WeekView } from './WeekView'
import './calendar.css'

const PANEL_KEY = 'jal.dayPanelCollapsed'

export function CalendarView(): JSX.Element {
  const { t } = useTranslation()
  const config = useAppStore((s) => s.config)
  const saveConfig = useAppStore((s) => s.saveConfig)
  const autoLoggerPrompt = useAppStore((s) => s.autoLoggerPrompt)
  const consumeAutoLoggerPrompt = useAppStore((s) => s.consumeAutoLoggerPrompt)
  const language = config.language
  const locale = dateLocale(language)
  const [wizardDates, setWizardDates] = useState<string[] | null>(null)
  const [wizardAutoStart, setWizardAutoStart] = useState(false)
  const [editing, setEditing] = useState<CalendarEntry | null>(null)
  const [taskFilter, setTaskFilter] = useState('')
  const drafts = useAppStore((s) => s.drafts)
  // A day that belongs to an unsubmitted generation reopens that whole run
  // instead of starting a blank one beside it.
  const openWizard = useCallback((dates: string[]) => {
    setWizardAutoStart(false)
    setWizardDates(findDraft(useAppStore.getState().drafts, dates)?.dates ?? dates)
  }, [])

  /** Days carrying suggestions that were generated but never submitted. */
  const draftDates = useMemo(
    () =>
      new Set(
        Object.values(drafts)
          .filter((draft) => draft.groups.length > 0)
          .flatMap((draft) => draft.dates)
      ),
    [drafts]
  )
  const calendar = useCalendar()
  const [newIssueOpen, setNewIssueOpen] = useState(false)
  // The day panel can fold into a strip, like a side bar; remembered per machine.
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) === '1'
    } catch {
      return false
    }
  })
  const togglePanel = useCallback(() => {
    setPanelCollapsed((current) => {
      try {
        localStorage.setItem(PANEL_KEY, current ? '0' : '1')
      } catch {
        // Not remembered, still toggled.
      }
      return !current
    })
  }, [])
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePanel])
  const [createdIssue, setCreatedIssue] = useState<{ key: string; summary: string; url: string } | null>(null)

  // Confirmation mode generates straight away; notify-only opens the wizard
  // untouched, exactly as asking for suggestions for that day does.
  useEffect(() => {
    if (!autoLoggerPrompt) return
    const date = autoLoggerPrompt.date
    setWizardAutoStart(autoLoggerPrompt.autoStart)
    setWizardDates(findDraft(useAppStore.getState().drafts, [date])?.dates ?? [date])
    consumeAutoLoggerPrompt()
  }, [autoLoggerPrompt, consumeAutoLoggerPrompt])

  // ---------- Task filter ----------
  // Autocomplete is sourced from the tasks that actually have entries in the
  // loaded range - filtering by a task with no entries would highlight nothing.
  const loadedEntries = useMemo(
    () => [...calendar.worklogsByDate.values()].flat(),
    [calendar.worklogsByDate]
  )

  const taskOptions = useMemo(() => {
    const byKey = new Map<string, { key: string; summary: string }>()
    for (const entry of loadedEntries) {
      const current = byKey.get(entry.issueKey) ?? { key: entry.issueKey, summary: entry.issueSummary }
      if (!current.summary && entry.issueSummary) current.summary = entry.issueSummary
      byKey.set(entry.issueKey, current)
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
  }, [loadedEntries])

  const filterKey = taskFilter.trim().toUpperCase()
  const filterActive = filterKey.length > 0
  const matchEntry = useCallback(
    (entry: CalendarEntry): boolean => entry.issueKey.toUpperCase().includes(filterKey),
    [filterKey]
  )
  // The total is scoped to what's on screen: the focused day in the day view,
  // its week in the week view, the whole month in the month view.
  const isDayView = calendar.view === 'day'
  const isWeekView = calendar.view === 'week'
  const scopedEntries = useMemo(() => {
    if (isDayView) {
      const iso = toIsoDate(calendar.focusedDay)
      return loadedEntries.filter((e) => e.startDate === iso)
    }
    if (isWeekView) {
      const week = new Set(calendar.weekDays.map(toIsoDate))
      return loadedEntries.filter((e) => week.has(e.startDate))
    }
    const monthPrefix = format(calendar.month, 'yyyy-MM')
    return loadedEntries.filter((e) => e.startDate.startsWith(monthPrefix))
  }, [loadedEntries, isDayView, isWeekView, calendar.focusedDay, calendar.weekDays, calendar.month])
  const filteredSeconds = filterActive
    ? scopedEntries.filter(matchEntry).reduce((sum, e) => sum + e.timeSpentSeconds, 0)
    : 0
  /** Predicate handed to the day/month renderers; undefined = no active filter. */
  const entryMatcher = filterActive ? matchEntry : undefined

  const toggleConnection = (id: string): void => {
    const active = config.activeConnectionIds.includes(id)
      ? config.activeConnectionIds.filter((a) => a !== id)
      : [...config.activeConnectionIds, id]
    void saveConfig({ ...config, activeConnectionIds: active })
  }

  /** Jira projects of the configured (not archived) projects, for "New issue". */
  const issueTargets = useMemo<IssueTarget[]>(() => {
    const seen = new Set<string>()
    return config.projects
      .filter((project) => !project.archived)
      .flatMap((project) =>
        project.targets.flatMap((target) => {
          const connection = config.connections.find((c) => c.id === target.connectionId)
          const id = `${target.connectionId}|${target.jiraProjectKey}`
          if (!connection || !target.jiraProjectKey || seen.has(id)) return []
          seen.add(id)
          return [
            {
              connectionId: connection.id,
              connectionName: connection.name || connection.jira.baseUrl,
              projectKey: target.jiraProjectKey,
              projectName: project.name
            }
          ]
        })
      )
  }, [config.projects, config.connections])

  const showWeekends = config.showWeekends
  const isWeekendDay = (d: Date): boolean => d.getDay() === 0 || d.getDay() === 6
  const toggleWeekends = (): void => void saveConfig({ ...config, showWeekends: !config.showWeekends })
  const allWeekdays = t('calendar.weekdays', { returnObjects: true }) as string[]
  // Weekday labels run Mon..Sun; dropping the last two hides Sat/Sun.
  const weekdays = showWeekends ? allWeekdays : allWeekdays.slice(0, 5)
  const focusedIso = toIsoDate(calendar.focusedDay)
  const selectedDates = [...calendar.selected].sort()
  const weekDays = calendar.weekDays.filter((day) => showWeekends || !isWeekendDay(day))
  // Nothing selected: the panel shows today, or else the first day on screen.
  const todayIso = toIsoDate(new Date())
  const inspectedDates =
    selectedDates.length > 0
      ? selectedDates
      : isWeekView
        ? [weekDays.some((d) => toIsoDate(d) === todayIso) ? todayIso : focusedIso]
        : [toIsoDate(isSameMonth(new Date(), calendar.month) ? new Date() : startOfMonth(calendar.month))]
  const panelDates = isDayView ? [focusedIso] : inspectedDates
  const panelEntries = panelDates.flatMap((d) => calendar.worklogsByDate.get(d) ?? [])
  const isoDay = (iso: string): Date => new Date(`${iso}T00:00:00`)
  const step = (offset: number): void =>
    isDayView ? calendar.goToDay(offset) : isWeekView ? calendar.goToWeek(offset) : calendar.goToMonth(offset)
  const dayTarget = config.workingHoursPerDay * 3600

  const onWizardDone = (): void => {
    setWizardDates(null)
    setWizardAutoStart(false)
    calendar.clearSelection()
    calendar.reload()
  }

  return (
    <div className="calendar">
      <header className="page-header">
        <div className="calendar-nav">
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => step(-1)}
            aria-label={t(isDayView ? 'calendar.previousDay' : isWeekView ? 'calendar.previousWeek' : 'calendar.previousMonth')}
          >
            <Icon name="chevronLeft" />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => step(1)}
            aria-label={t(isDayView ? 'calendar.nextDay' : isWeekView ? 'calendar.nextWeek' : 'calendar.nextMonth')}
          >
            <Icon name="chevronRight" />
          </button>
          <h1 className="page-title calendar-title">
            {isDayView ? (
              <>
                {format(calendar.focusedDay, 'EEEE', { locale })}{' '}
                <span className="soft">{format(calendar.focusedDay, 'd MMMM', { locale })}</span>
              </>
            ) : isWeekView ? (
              <>
                {format(weekDays[0], 'd MMM', { locale })} – {format(weekDays[weekDays.length - 1], 'd MMM', { locale })}{' '}
                <span className="soft">{format(weekDays[weekDays.length - 1], 'yyyy')}</span>
              </>
            ) : (
              <>
                {format(calendar.month, 'LLLL', { locale })}{' '}
                <span className="soft">{format(calendar.month, 'yyyy')}</span>
              </>
            )}
          </h1>
        </div>
        <div className="segmented" role="group" aria-label={t('calendar.view')}>
          <button className={calendar.view === 'month' ? 'active' : ''} onClick={() => calendar.setView('month')}>
            {t('calendar.viewMonth')}
          </button>
          <button
            className={isWeekView ? 'active' : ''}
            onClick={() => calendar.openWeek(new Date(`${inspectedDates[0]}T00:00:00`))}
          >
            {t('calendar.viewWeek')}
          </button>
          <button className={isDayView ? 'active' : ''} onClick={() => calendar.setView('day')}>
            {t('calendar.viewDay')}
          </button>
        </div>
        <button className="btn" onClick={calendar.goToToday}>
          {t('calendar.today')}
        </button>
        <HelpTip label={t('calendar.helpLabel')}>{t('calendar.selectHint')}</HelpTip>
        {calendar.loading && <span className="spinner" />}
        <div className="spacer" />
        {taskOptions.length > 0 && (
          <label className="search-field">
            <Icon name="search" size={15} />
            <span className="visually-hidden">{t('calendar.filterPlaceholder')}</span>
            <input
              list="calendar-task-filter"
              value={taskFilter}
              placeholder={t('calendar.filterPlaceholder')}
              spellCheck={false}
              onChange={(e) => setTaskFilter(e.target.value.split('—')[0].trim())}
            />
            <datalist id="calendar-task-filter">
              {taskOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {`${option.key} — ${option.summary}`}
                </option>
              ))}
            </datalist>
          </label>
        )}
        {issueTargets.length > 0 && (
          <button className="btn" onClick={() => setNewIssueOpen(true)}>
            <Icon name="plus" size={15} />
            {t('issues.newButton')}
          </button>
        )}
        <button
          className="btn btn-primary"
          onClick={() => openWizard(isDayView ? [focusedIso] : inspectedDates)}
        >
          <Icon name="plus" size={15} />
          {t('calendar.newEntries')}
        </button>
        <button
          className={`btn btn-icon panel-toggle ${panelCollapsed ? '' : 'active'}`}
          onClick={togglePanel}
          aria-pressed={!panelCollapsed}
          aria-label={t('calendar.dayPanel')}
          title={`${t(panelCollapsed ? 'calendar.showPanel' : 'calendar.hidePanel')} (Ctrl+B)`}
        >
          <Icon name="panel" />
        </button>
      </header>

      {filterActive && (
        <div className="calendar-filter-row">
          <span>
            <b className="mono">{filterKey}</b>{' '}
            <span className="muted">
              {t(isDayView ? 'calendar.filterTotalDay' : isWeekView ? 'calendar.filterTotalWeek' : 'calendar.filterTotalMonth', {
                hours: formatHours(filteredSeconds)
              })}
            </span>
          </span>
          <button className="link" onClick={() => setTaskFilter('')}>
            {t('calendar.clearFilter')}
          </button>
        </div>
      )}

      {calendar.error && <ErrorBanner error={calendar.error} onRetry={calendar.reload} />}

      {createdIssue && (
        <div className="banner banner-success">
          <Icon name="check" size={16} />
          <span className="spacer">
            {t('issues.created', { key: createdIssue.key })} <span className="muted">{createdIssue.summary}</span>
          </span>
          {createdIssue.url && (
            <button className="btn btn-sm" onClick={() => openExternal(createdIssue.url)}>
              {t('wizard.openInJira')} ↗
            </button>
          )}
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCreatedIssue(null)} aria-label={t('app.close')}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {newIssueOpen && (
        <NewIssuePanel
          mode="create"
          targets={issueTargets}
          onCreated={(issue, target) => {
            const connection = config.connections.find((c) => c.id === target.connectionId)
            setCreatedIssue({
              key: issue.key,
              summary: issue.summary,
              url: jiraIssueUrl(connection?.jira.baseUrl ?? '', issue.key)
            })
          }}
          onClose={() => setNewIssueOpen(false)}
        />
      )}

      {calendar.view === 'month' && (
        <MonthSummary
          config={config}
          month={calendar.month}
          days={calendar.days}
          worklogsByDate={calendar.worklogsByDate}
          loading={calendar.loading}
          onToggleConnection={toggleConnection}
          onFillMissing={openWizard}
        />
      )}

      <div className="calendar-body">
        {isDayView ? (
          <DayView
            day={calendar.focusedDay}
            entries={calendar.worklogsByDate.get(focusedIso) ?? []}
            connections={config.connections.filter((c) => config.activeConnectionIds.includes(c.id))}
            workingHoursPerDay={config.workingHoursPerDay}
            onEditEntry={setEditing}
            matchEntry={entryMatcher}
          />
        ) : isWeekView ? (
          <WeekView
            days={weekDays}
            worklogsByDate={calendar.worklogsByDate}
            selected={calendar.selected}
            draftDates={draftDates}
            dayTarget={dayTarget}
            loading={calendar.loading}
            onDayMouseDown={calendar.onDayMouseDown}
            onDayMouseEnter={calendar.onDayMouseEnter}
            onAddEntries={openWizard}
            onEditEntry={setEditing}
            matchEntry={entryMatcher}
          />
        ) : (
          <div className="calendar-month">
            <div className={`calendar-weekdays ${showWeekends ? '' : 'no-weekends'}`}>
              {weekdays.map((day, index) =>
                showWeekends && index === 6 ? (
                  <span key={day} className="calendar-weekday-last">
                    {day}
                    <button
                      className="calendar-weekend-toggle"
                      onClick={toggleWeekends}
                      aria-label={t('calendar.foldWeekend')}
                      title={t('calendar.foldWeekend')}
                    >
                      <Icon name="foldLeft" size={13} />
                    </button>
                  </span>
                ) : (
                  <span key={day}>{day}</span>
                )
              )}
              {!showWeekends && (
                <button
                  className="calendar-weekend-toggle"
                  onClick={toggleWeekends}
                  aria-label={t('calendar.showWeekend')}
                  title={t('calendar.showWeekend')}
                >
                  <Icon name="foldRight" size={13} />
                </button>
              )}
            </div>
            <div className={`calendar-grid ${showWeekends ? '' : 'no-weekends'}`} role="grid">
              {calendar.days.map((day) => {
                  // A hidden weekend folds into one narrow cell per week.
                  if (!showWeekends && isWeekendDay(day)) {
                    if (day.getDay() !== 6) return null
                    const sunday = addDays(day, 1)
                    const weekendSeconds = [day, sunday]
                      .flatMap((d) => calendar.worklogsByDate.get(toIsoDate(d)) ?? [])
                      .reduce((sum, w) => sum + w.timeSpentSeconds, 0)
                    const label = t('calendar.weekendFold', {
                      from: day.getDate(),
                      to: sunday.getDate(),
                      hours: formatHours(weekendSeconds)
                    })
                    return (
                      <button
                        key={toIsoDate(day)}
                        className={`calendar-weekend-fold ${isSameMonth(day, calendar.month) ? '' : 'outside'}`}
                        onClick={toggleWeekends}
                        title={weekendSeconds > 0 ? label : t('calendar.showWeekend')}
                        aria-label={weekendSeconds > 0 ? label : t('calendar.showWeekend')}
                      >
                        <span className="calendar-weekend-fold-label">
                          {day.getDate()}–{sunday.getDate()}
                        </span>
                        {weekendSeconds > 0 && <span className="calendar-weekend-fold-dot" />}
                      </button>
                    )
                  }
                  const iso = toIsoDate(day)
                  const worklogs = calendar.worklogsByDate.get(iso) ?? []
                  const totalSeconds = worklogs.reduce((sum, w) => sum + w.timeSpentSeconds, 0)
                  const weekend = isWeekendDay(day)
                  const past = day < new Date() && !isToday(day)
                  // Unknown until the month has loaded - an empty day is not a missing one yet.
                  const missing =
                    !calendar.loading && isSameMonth(day, calendar.month) && !weekend && past && worklogs.length === 0
                  // A day logged to two Jiras is two full days of work, not an overrun.
                  const jiras = new Set(worklogs.map((w) => w.connectionId)).size
                  const target = dayTarget * Math.max(1, jiras)
                  const complete = totalSeconds >= target
                  const classes = [
                    'calendar-day',
                    !isSameMonth(day, calendar.month) && 'outside',
                    weekend && 'weekend',
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
                      aria-selected={calendar.selected.has(iso)}
                      aria-label={`${format(day, 'PPPP', { locale })}, ${formatHours(totalSeconds)} ${t('app.hoursShort')}`}
                      onMouseDown={(e) => e.button === 0 && calendar.onDayMouseDown(day)}
                      onMouseEnter={() => calendar.onDayMouseEnter(day)}
                      onDoubleClick={() => openWizard([iso])}
                    >
                      <div className="calendar-day-head">
                        <span className="calendar-day-number">{day.getDate()}</span>
                        <span className="calendar-day-meta">
                          {draftDates.has(iso) && (
                            <span className="calendar-day-draft" title={t('calendar.draftPending')}>
                              ✎
                            </span>
                          )}
                          {totalSeconds > 0 && (
                            <span className={`calendar-day-total mono ${complete ? '' : 'partial'}`}>
                              {formatHours(totalSeconds)}
                              {t('app.hoursShort')}
                            </span>
                          )}
                        </span>
                      </div>
                      <MonthDayEntries
                        entries={worklogs}
                        onEditEntry={setEditing}
                        onShowMore={() => calendar.openDay(day)}
                        matchEntry={entryMatcher}
                      />
                      {missing && <span className="calendar-day-missing">{t('calendar.nothingLogged')}</span>}
                      {(totalSeconds > 0 || missing) && (
                        <span className="calendar-day-bar" aria-hidden>
                          <span
                            className={complete ? 'complete' : 'partial'}
                            style={{ width: `${Math.min(100, (totalSeconds / target) * 100)}%` }}
                          />
                        </span>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>
        )}

        {panelCollapsed ? (
          <DayInspectorStrip
            title={
              panelDates.length > 1
                ? `${format(isoDay(panelDates[0]), 'd MMM', { locale })} – ${format(isoDay(panelDates[panelDates.length - 1]), 'd MMM', { locale })}`
                : format(isoDay(panelDates[0]), 'd MMMM', { locale })
            }
            totalSeconds={panelEntries.reduce((sum, e) => sum + e.timeSpentSeconds, 0)}
            entries={panelEntries}
            onExpand={togglePanel}
          />
        ) : (
          <DayInspector
            config={config}
            dates={panelDates}
            worklogsByDate={calendar.worklogsByDate}
            draftDates={draftDates}
            onSuggest={openWizard}
            onOpenDay={calendar.openDay}
            onEditEntry={setEditing}
            onClearSelection={calendar.clearSelection}
            onSelectDay={calendar.selectDay}
            onLogged={calendar.reload}
          />
        )}
      </div>

      {wizardDates && (
        <SuggestionWizard
          key={`${wizardDates.join(',')}:${wizardAutoStart ? 'auto' : 'manual'}`}
          dates={wizardDates}
          autoStart={wizardAutoStart}
          onClose={() => {
            setWizardDates(null)
            setWizardAutoStart(false)
          }}
          onDone={onWizardDone}
        />
      )}

      {editing && (
        <EntryEditor
          entry={editing}
          jiraBaseUrl={
            config.connections.find((c) => c.id === editing.connectionId)?.jira.baseUrl ?? ''
          }
          customFields={config.customFields.filter((f) => f.connectionId === editing.connectionId)}
          instruction={
            config.projects
              .flatMap((p) => p.targets)
              .find(
                (t) =>
                  t.connectionId === editing.connectionId &&
                  editing.issueKey.startsWith(`${t.jiraProjectKey}-`)
              )?.instruction ?? ''
          }
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            calendar.reload()
          }}
        />
      )}
    </div>
  )
}
