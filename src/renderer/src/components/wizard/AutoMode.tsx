import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format, type Locale } from 'date-fns'
import type {
  ActivityEvent,
  ActivityScanResult,
  AppError,
  ProjectActivity,
  ProjectConfig,
  ProjectDayActivity,
  ProjectSelection
} from '@shared/domain'
import { Icon } from '@/components/common/Icon'
import { formatHours } from '@/utils/format'

/**
 * Auto mode of the wizard's first step: the backend scan (git, Jira, Tempo)
 * picks the projects and suggests how the day's hours split between them.
 * Everything it decides stays editable - it only pre-fills the selection.
 */

const h = (hours: number): string => formatHours(hours * 3600)

export function useActivityScan(dates: string[], enabled: boolean): {
  scan: ActivityScanResult | null
  loading: boolean
  error: AppError | null
  rescan(): void
} {
  const [scan, setScan] = useState<ActivityScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [counter, setCounter] = useState(0)
  const key = dates.join(',')

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void window.api.activity.scan({ dates }).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (result.ok) setScan(result.value)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
    // Keyed by the dates' content, not the array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, counter])

  const rescan = useCallback(() => setCounter((c) => c + 1), [])
  return { scan, loading, error, rescan }
}

/** The selection auto mode proposes: projects with evidence or a likely habit, with their hints. */
export function selectionsFromScan(
  scan: ActivityScanResult,
  projects: Map<string, ProjectConfig>,
  previous: ProjectSelection[]
): ProjectSelection[] {
  return scan.projects
    .filter((p) => p.status !== 'none' && projects.has(p.projectId))
    .map((p) => {
      const kept = previous.find((s) => s.projectId === p.projectId)
      return {
        projectId: p.projectId,
        // A rescan must not wipe what the user already typed.
        note: kept?.note ?? '',
        useCommits: kept?.useCommits ?? (projects.get(p.projectId)?.gitFolders.length ?? 0) > 0,
        allowNewIssues: kept?.allowNewIssues,
        hoursHint: hintsOf(p)
      }
    })
}

export function hintsOf(activity: ProjectActivity): Record<string, number> {
  return Object.fromEntries(activity.days.filter((d) => d.hoursHint > 0).map((d) => [d.date, d.hoursHint]))
}

export const hintTotal = (selection: ProjectSelection): number =>
  Object.values(selection.hoursHint ?? {}).reduce((sum, hours) => sum + hours, 0)

const STRIPES = (color: string): string =>
  `repeating-linear-gradient(135deg, ${color} 0 3px, color-mix(in srgb, ${color} 30%, transparent) 3px 6px)`

/** Sidebar: the day's budget and how the selected projects share it. */
export function AutoBudget({
  scan,
  selections,
  projects,
  loading,
  onRescan
}: {
  scan: ActivityScanResult
  selections: ProjectSelection[]
  projects: Map<string, ProjectConfig>
  loading: boolean
  onRescan(): void
}): JSX.Element {
  const { t } = useTranslation()
  const working = scan.days.reduce((sum, d) => sum + d.workingHours, 0)
  const logged = scan.days.reduce((sum, d) => sum + d.loggedHours, 0)
  const remaining = scan.days.reduce((sum, d) => sum + d.remainingHours, 0)
  const statusOf = (id: string): string => scan.projects.find((p) => p.projectId === id)?.status ?? 'none'
  const share = (hours: number): string => `${Math.min(100, (hours / Math.max(working, 0.01)) * 100)}%`
  return (
    <section className="auto-budget" aria-label={t('wizard.autoBudget')}>
      <div className="auto-budget-head">
        <span className="mono auto-budget-left">{h(remaining)} h</span>
        <span className="mono muted">/ {h(working)} h</span>
        <span className="spacer" />
        <button className="btn btn-icon btn-sm" onClick={onRescan} disabled={loading} aria-label={t('wizard.rescan')} title={t('wizard.rescan')}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={14} />}
        </button>
      </div>
      <div className="auto-bar" aria-hidden>
        {logged > 0 && <span style={{ width: share(logged), background: STRIPES('var(--muted)') }} />}
        {selections.map((s) => {
          const color = projects.get(s.projectId)?.color || 'var(--muted)'
          const hours = hintTotal(s)
          if (hours <= 0) return null
          return (
            <span
              key={s.projectId}
              style={{ width: share(hours), background: statusOf(s.projectId) === 'likely' ? STRIPES(color) : color }}
            />
          )
        })}
      </div>
      {logged > 0 && (
        <span className="auto-budget-logged muted">
          <span className="auto-swatch" style={{ background: STRIPES('var(--muted)') }} />
          {t('wizard.loggedInTempo', { hours: h(logged) })}
        </span>
      )}
    </section>
  )
}

/** One line of numbers under a project's name: what the scan found. */
function evidenceLine(t: (key: string, options?: Record<string, unknown>) => string, activity: ProjectActivity): string {
  if (activity.status === 'likely') return t('wizard.likely')
  const commits = activity.days.reduce((sum, d) => sum + d.commitCount, 0)
  const jira = activity.days.reduce((sum, d) => sum + d.jiraActivityCount, 0)
  const uncommitted = activity.days.some((d) => d.uncommitted)
  return [
    commits > 0 && t('wizard.commitCount', { count: commits }),
    jira > 0 && t('wizard.jiraCount', { count: jira }),
    uncommitted && t('wizard.inProgress')
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Sidebar: projects grouped by what the scan found, each with its hours. */
export function AutoPickList({
  scan,
  selections,
  projects,
  onToggle
}: {
  scan: ActivityScanResult
  selections: ProjectSelection[]
  projects: Map<string, ProjectConfig>
  onToggle(project: ProjectConfig, activity: ProjectActivity): void
}): JSX.Element {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)
  const found = scan.projects.filter((p) => p.status !== 'none' && projects.has(p.projectId))
  const rest = scan.projects.filter((p) => p.status === 'none' && projects.has(p.projectId))
  // Ticking a project without traces keeps it in place, so it does not jump groups.
  const shownRest = showAll ? rest : rest.filter((p, i) => i < 1 || selections.some((s) => s.projectId === p.projectId))

  const row = (activity: ProjectActivity): JSX.Element => {
    const project = projects.get(activity.projectId)!
    const selection = selections.find((s) => s.projectId === project.id)
    const color = project.color || 'var(--muted)'
    const sub = evidenceLine(t, activity)
    return (
      <label key={project.id} className={`wizard-pick auto-pick ${selection ? 'selected' : ''} ${activity.status}`}>
        <input type="checkbox" checked={Boolean(selection)} onChange={() => onToggle(project, activity)} />
        <span className="wizard-pick-text">
          <span className="auto-pick-name">
            <span className="chip-dot" style={{ background: color }} />
            {project.name}
          </span>
          {sub && <span className={`auto-pick-sub ${activity.status === 'likely' ? 'likely' : 'muted'}`}>{sub}</span>}
        </span>
        {selection && hintTotal(selection) > 0 && (
          <span className="mono auto-pick-hours" style={{ color: activity.status === 'likely' ? 'var(--warning)' : color }}>
            {h(hintTotal(selection))} h
          </span>
        )}
      </label>
    )
  }

  return (
    <div className="wizard-side-block auto-picks">
      {found.map(row)}
      {found.length === 0 && <span className="hint">{t('wizard.autoNothingFound')}</span>}
      {rest.length > 0 && (
        <>
          <span className="eyebrow auto-picks-rest">{t('wizard.noTraces')}</span>
          {shownRest.map(row)}
          {!showAll && rest.length > shownRest.length && (
            <button className="link auto-more" onClick={() => setShowAll(true)}>
              <Icon name="chevronDown" size={12} />
              {t('wizard.moreProjects', { count: rest.length - shownRest.length })}
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** "status: A -> B" and friends from the backend, in the UI's words. */
function jiraText(t: (key: string, options?: Record<string, unknown>) => string, text: string): string {
  if (text.startsWith('status: ')) return text.slice(8).replace(' -> ', ' → ')
  if (text.startsWith('comment: ')) return t('wizard.jiraComment', { text: text.slice(9) })
  if (text.startsWith('assignee: ')) return t('wizard.jiraAssignee', { name: text.slice(10) })
  if (text.startsWith('edited ')) return t('wizard.jiraEdited', { field: text.slice(7) })
  return text
}

const TIMELINE_START = 8 * 60
const TIMELINE_END = 20 * 60
const position = (time: string): number => {
  const [hh, mm] = time.split(':').map(Number)
  const minutes = (hh || 0) * 60 + (mm || 0)
  return Math.min(100, Math.max(0, ((minutes - TIMELINE_START) / (TIMELINE_END - TIMELINE_START)) * 100))
}

/** Commit dot size grows with the change, so a migration stands out from a typo fix. */
const dotSize = (lines: number): number => Math.round(Math.min(24, 8 + Math.log10(Math.max(lines, 1)) * 5))

function Timeline({ day, color }: { day: ProjectDayActivity; color: string }): JSX.Element {
  const timed = day.events.filter((e) => e.kind !== 'uncommitted' && e.time)
  const times = timed.map((e) => position(e.time))
  const from = times.length ? Math.min(...times) : 0
  const to = times.length ? Math.max(...times) : 0
  return (
    <div className="auto-timeline" aria-hidden>
      <div className="auto-track">
        {times.length > 1 && (
          <span className="auto-span" style={{ left: `${from}%`, width: `${to - from}%`, background: color }} />
        )}
        {timed.map((e, i) =>
          e.kind === 'jira' ? (
            <span key={i} className="auto-mark jira" style={{ left: `${position(e.time)}%` }} title={`${e.time} ${e.issueKey}`} />
          ) : (
            <span
              key={i}
              className="auto-mark commit"
              title={`${e.time} +${e.additions} −${e.deletions}`}
              style={{ left: `${position(e.time)}%`, background: color, width: dotSize(e.additions + e.deletions), height: dotSize(e.additions + e.deletions) }}
            />
          )
        )}
        {day.uncommitted && <span className="auto-mark uncommitted" style={{ left: '96%', borderColor: color }} />}
      </div>
      <div className="mono auto-ticks">
        {[8, 10, 12, 14, 16, 18, 20].map((hour) => (
          <span key={hour}>{hour}:00</span>
        ))}
      </div>
    </div>
  )
}

const EVENT_LIMIT = 4

/** A thin day: one small commit or nothing, no Jira - the work most likely went on off-git. */
const isThin = (day: ProjectDayActivity): boolean =>
  day.status === 'evidence' && day.jiraActivityCount === 0 && !day.uncommitted && day.commitCount <= 1 && day.additions + day.deletions < 60

/** The issue the recent days went to most, for the continuation chip. */
function continuedIssue(activity: ProjectActivity): string {
  const hours = new Map<string, number>()
  for (const d of activity.recentDays) {
    if (d.issueKey) hours.set(d.issueKey, (hours.get(d.issueKey) ?? 0) + d.hours)
  }
  return [...hours.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

/** Main column: what the scan found for one project - the day's timeline and its traces. */
export function ActivityTrail({
  activity,
  color,
  workingHours,
  locale
}: {
  activity: ProjectActivity
  color: string
  workingHours: number
  locale: Locale
}): JSX.Element | null {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)
  const multiDay = activity.days.length > 1
  const events: (ActivityEvent & { date: string })[] = activity.days
    .slice()
    .reverse()
    .flatMap((d) => d.events.map((e) => ({ ...e, date: d.date })))
  const thinDay = activity.days.find(isThin)
  const issue = thinDay ? continuedIssue(activity) : ''
  const shown = showAll ? events : events.slice(0, EVENT_LIMIT)

  if (activity.status === 'none') return null
  return (
    <div className="auto-trail">
      {activity.days
        .filter((d) => d.events.length > 0)
        .map((d) => (
          <div key={d.date} className="auto-trail-day">
            {multiDay && <span className="mono muted auto-trail-date">{d.date.slice(5)}</span>}
            <Timeline day={d} color={color} />
          </div>
        ))}

      {shown.length > 0 && (
        <ul className="auto-events">
          {shown.map((e, i) => (
            <li key={i}>
              <span className="mono muted">
                {multiDay && `${e.date.slice(5)} `}
                {e.kind === 'uncommitted' ? t('wizard.now') : e.time}
              </span>
              <span className={`auto-glyph ${e.kind}`} style={e.kind === 'jira' ? undefined : { background: e.kind === 'commit' ? color : undefined, borderColor: color }} />
              <span className="auto-event-text">
                {e.kind === 'jira' && <span className="mono auto-key">{e.issueKey}</span>}
                {e.kind === 'commit' && e.text}
                {e.kind === 'jira' && jiraText(t, e.text)}
                {e.kind === 'uncommitted' && <span className="muted">{t('wizard.uncommittedFiles', { count: e.files })}</span>}
              </span>
              <span className="mono muted auto-event-size">
                {e.kind === 'jira' ? 'Jira' : `+${e.additions} −${e.deletions}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {events.length > EVENT_LIMIT && !showAll && (
        <button className="link auto-more" onClick={() => setShowAll(true)}>
          {t('wizard.allTraces', { count: events.length })}
        </button>
      )}

      {thinDay && issue && activity.recentDays.length > 0 && (
        <div className="auto-continue">
          <div className="auto-continue-head">
            <Icon name="history" size={15} />
            <b>{t('wizard.continuation')}</b>
            <span className="mono auto-chip accent">{issue}</span>
            {thinDay.branch && (
              <span className="mono auto-chip">
                <Icon name="branch" size={12} />
                {thinDay.branch}
              </span>
            )}
          </div>
          {activity.recentDays.map((d) => (
            <div key={d.date} className="auto-continue-day">
              <span className="muted">{format(new Date(d.date), 'EEE d', { locale })}</span>
              <span className="auto-continue-bar">
                <span style={{ width: `${Math.min(100, (d.hours / Math.max(workingHours, 0.01)) * 100)}%`, background: color }} />
              </span>
              <span className="mono muted">{h(d.hours)} h</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
