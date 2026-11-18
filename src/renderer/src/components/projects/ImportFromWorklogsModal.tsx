import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { startOfMonth, startOfQuarter, startOfYear, subDays, subMonths, endOfMonth } from 'date-fns'
import { PROJECT_COLOR_PALETTE } from '@shared/domain'
import type { AppError, JiraConnection, ProjectConfig } from '@shared/domain'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { Icon } from '@/components/common/Icon'
import { Modal } from '@/components/common/Modal'
import { formatHours, toIsoDate } from '@/utils/format'

interface FoundProject {
  connectionId: string
  key: string
  name: string
  seconds: number
  entries: number
  /** Name of the saved or draft project that already logs to this key, if any. */
  configuredIn: string | null
}

interface Props {
  connections: JiraConnection[]
  /** The current draft, so already-mapped Jira projects are recognised. */
  projects: ProjectConfig[]
  onClose: () => void
  onImport: (projects: ProjectConfig[]) => void
}

type RangeId = 'month' | 'prevMonth' | 'last30' | 'quarter' | 'year'

const RANGES: RangeId[] = ['month', 'prevMonth', 'last30', 'quarter', 'year']

function rangeDates(id: RangeId, today = new Date()): [string, string] {
  switch (id) {
    case 'month':
      return [toIsoDate(startOfMonth(today)), toIsoDate(today)]
    case 'prevMonth': {
      const prev = subMonths(today, 1)
      return [toIsoDate(startOfMonth(prev)), toIsoDate(endOfMonth(prev))]
    }
    case 'last30':
      return [toIsoDate(subDays(today, 30)), toIsoDate(today)]
    case 'quarter':
      return [toIsoDate(startOfQuarter(today)), toIsoDate(today)]
    case 'year':
      return [toIsoDate(startOfYear(today)), toIsoDate(today)]
  }
}

const rowId = (p: { connectionId: string; key: string }): string => `${p.connectionId}::${p.key}`

/** "SHOP-123" -> "SHOP"; Jira issue keys are always PROJECT-NUMBER. */
const projectKeyOf = (issueKey: string): string => {
  const dash = issueKey.lastIndexOf('-')
  return dash > 0 ? issueKey.slice(0, dash).toUpperCase() : ''
}

const SKELETON_ROWS = [62, 48, 70, 40, 56, 34]

/**
 * Discovers the Jira projects the user logged time to in a date range (from
 * their Tempo worklogs) and turns the picked ones into project configs, so a
 * fresh install doesn't start with typing every project key by hand.
 */
export function ImportFromWorklogsModal({ connections, projects, onClose, onImport }: Props): JSX.Element {
  const { t } = useTranslation()
  const [range, setRange] = useState<RangeId | null>('last30')
  const [[from, to], setDates] = useState<[string, string]>(() => rangeDates('last30'))
  const [loading, setLoading] = useState(false)
  const [doneConnections, setDoneConnections] = useState<string[]>([])
  const [errors, setErrors] = useState<AppError[]>([])
  const [found, setFound] = useState<FoundProject[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Only the newest search may write results: switching ranges quickly must
  // not let a slower, older response overwrite the current one.
  const searchId = useRef(0)

  /** connection::KEY -> name of the project already logging there. */
  const configured = useMemo(() => {
    const map = new Map<string, string>()
    for (const project of projects) {
      for (const target of project.targets) {
        const id = rowId({ connectionId: target.connectionId, key: target.jiraProjectKey.toUpperCase() })
        if (!map.has(id)) map.set(id, project.name.trim() || t('projects.unnamedTitle'))
      }
    }
    return map
  }, [projects, t])

  const rangeInvalid = !from || !to || from > to

  useEffect(() => {
    const id = ++searchId.current
    if (rangeInvalid) {
      // Drops any search still in flight, which would otherwise never clear `loading`.
      setLoading(false)
      return
    }
    // Typing a date fires per keystroke; wait until it settles.
    const timer = setTimeout(() => void search(id), 250)
    return () => clearTimeout(timer)
    // `configured` is read once per search on purpose: the draft can't change
    // while this dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, rangeInvalid])

  const search = async (id: number): Promise<void> => {
    setLoading(true)
    setErrors([])
    setDoneConnections([])
    const failures: AppError[] = []
    const perConnection = await Promise.all(
      connections.map(async (connection) => {
        const [worklogs, jiraProjects] = await Promise.all([
          window.api.tempo.getWorklogs(connection.id, from, to),
          window.api.jira.getProjects(connection.id)
        ])
        if (id === searchId.current) setDoneConnections((all) => [...all, connection.id])
        if (!worklogs.ok) {
          failures.push(worklogs.error)
          return []
        }
        // Project names are a nicety; without them the key still identifies it.
        const names = new Map(jiraProjects.ok ? jiraProjects.value.map((p) => [p.key.toUpperCase(), p.name]) : [])
        const byKey = new Map<string, FoundProject>()
        for (const worklog of worklogs.value) {
          const key = projectKeyOf(worklog.issueKey)
          if (!key) continue
          const row = byKey.get(key) ?? {
            connectionId: connection.id,
            key,
            name: names.get(key) ?? key,
            seconds: 0,
            entries: 0,
            configuredIn: configured.get(rowId({ connectionId: connection.id, key })) ?? null
          }
          row.seconds += worklog.timeSpentSeconds
          row.entries += 1
          byKey.set(key, row)
        }
        return [...byKey.values()]
      })
    )
    if (id !== searchId.current) return
    const rows = perConnection.flat().sort((a, b) => b.seconds - a.seconds)
    setErrors(failures)
    setFound(rows)
    setSelected(new Set(rows.filter((r) => !r.configuredIn).map(rowId)))
    setLoading(false)
  }

  const pickRange = (id: RangeId): void => {
    setRange(id)
    setDates(rangeDates(id))
  }

  const setDate = (which: 0 | 1, value: string): void => {
    setRange(null)
    setDates(([f, tt]) => (which === 0 ? [value, tt] : [f, value]))
  }

  const toggle = (id: string): void =>
    setSelected((all) => {
      const next = new Set(all)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const rows = found ?? []
  const fresh = rows.filter((r) => !r.configuredIn)
  const picked = fresh.filter((r) => selected.has(rowId(r)))
  const allPicked = fresh.length > 0 && picked.length === fresh.length
  const toggleAll = (): void => setSelected(allPicked ? new Set() : new Set(fresh.map(rowId)))

  /** The palette color each picked row will get, in list order (what the swatch previews). */
  const colorOf = useMemo(() => {
    const map = new Map<string, string>()
    picked.forEach((r, index) => {
      map.set(rowId(r), PROJECT_COLOR_PALETTE[(projects.length + index) % PROJECT_COLOR_PALETTE.length])
    })
    return map
  }, [picked, projects.length])

  const importSelected = (): void =>
    onImport(
      picked.map((r) => ({
        id: crypto.randomUUID(),
        name: r.name,
        targets: [{ id: crypto.randomUUID(), connectionId: r.connectionId, jiraProjectKey: r.key, instruction: '' }],
        gitFolders: [],
        color: colorOf.get(rowId(r)) ?? PROJECT_COLOR_PALETTE[0],
        archived: false
      }))
    )

  const connectionName = (id: string): string => {
    const connection = connections.find((c) => c.id === id)
    return connection ? connection.name || connection.jira.baseUrl : '—'
  }

  const totalSeconds = rows.reduce((sum, r) => sum + r.seconds, 0)
  const maxSeconds = rows[0]?.seconds ?? 1
  const connectionsWithTime = new Set(rows.map((r) => r.connectionId)).size

  return (
    <Modal
      title={t('projects.import.title')}
      onClose={onClose}
      footer={
        <>
          <span className="import-footer-note">
            {loading
              ? t('projects.import.loadingNote')
              : picked.length > 0
                ? t('projects.import.willAdd', { keys: picked.map((r) => r.key).join(', ') })
                : found && found.length > 0
                  ? t('projects.import.nothingPicked')
                  : null}
          </span>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('app.cancel')}
          </button>
          <button className="btn btn-primary" onClick={importSelected} disabled={loading || picked.length === 0}>
            <Icon name="plus" size={15} />
            {picked.length > 0 ? t('projects.import.add', { count: picked.length }) : t('projects.import.addNone')}
          </button>
        </>
      }
    >
      <div className="import-modal">
        <p className="hint import-subtitle">{t('projects.import.hint')}</p>

        <div className="chip-list" role="group" aria-label={t('projects.import.range')}>
          {RANGES.map((id) => (
            <button
              key={id}
              className={`chip import-range-chip ${range === id ? 'selected' : ''}`}
              aria-pressed={range === id}
              onClick={() => pickRange(id)}
            >
              {t(`projects.import.ranges.${id}`)}
            </button>
          ))}
        </div>

        <div className="import-dates">
          <label className="import-date">
            <span>{t('projects.import.from')}</span>
            <input type="date" value={from} max={to} onChange={(e) => setDate(0, e.target.value)} />
          </label>
          <Icon name="chevronRight" />
          <label className="import-date">
            <span>{t('projects.import.to')}</span>
            <input type="date" value={to} min={from} onChange={(e) => setDate(1, e.target.value)} />
          </label>
        </div>

        {errors.map((error, i) => (
          <ErrorBanner key={i} error={error} />
        ))}

        {loading && (
          <>
            <div className="import-progress" role="status">
              <span className="import-spinner" aria-hidden="true" />
              <span className="import-progress-text">
                <strong>{t('projects.import.loadingTitle', { count: connections.length })}</strong>
                {connections.length > 1 && (
                  <span className="muted">
                    {connections
                      .map((c) =>
                        t(doneConnections.includes(c.id) ? 'projects.import.connDone' : 'projects.import.connPending', {
                          name: connectionName(c.id)
                        })
                      )
                      .join(' · ')}
                  </span>
                )}
              </span>
              {connections.length > 1 && (
                <span className="mono muted">
                  {doneConnections.length} / {connections.length}
                </span>
              )}
            </div>
            <ul className="import-list" aria-hidden="true">
              {SKELETON_ROWS.map((width, i) => (
                <li key={i} className="import-row import-row-skeleton" style={{ opacity: 1 - i * 0.13 }}>
                  <span className="sk" style={{ width: 18, height: 18 }} />
                  <span className="sk import-swatch" />
                  <span className="import-row-main">
                    <span className="sk" style={{ width: `${width}%`, height: 14 }} />
                    <span className="sk" style={{ width: 140, height: 10 }} />
                  </span>
                  <span className="import-row-hours">
                    <span className="sk" style={{ width: 52, height: 14 }} />
                    <span className="sk" style={{ width: `${100 - i * 14}%`, height: 5 }} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {!loading && found && found.length === 0 && (
          <div className="import-empty">
            <Icon name="clock" size={22} />
            <span>{t('projects.import.empty')}</span>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <>
            <div className="import-stats">
              <div>
                <strong>
                  {formatHours(totalSeconds)}
                  <small> h</small>
                </strong>
                <span>{t('projects.import.statHours')}</span>
              </div>
              <div>
                <strong>{rows.length}</strong>
                <span>
                  {t('projects.import.statProjects', { count: rows.length })}
                  {connectionsWithTime > 1 && `, ${t('projects.import.statConnections', { count: connectionsWithTime })}`}
                </span>
              </div>
              <div>
                <strong className={fresh.length > 0 ? 'import-stat-new' : undefined}>{fresh.length}</strong>
                <span>{t('projects.import.statNew', { count: fresh.length })}</span>
              </div>
            </div>

            <div className="import-list-head">
              {fresh.length > 0 && (
                <label className="checkbox-label">
                  <input type="checkbox" checked={allPicked} onChange={toggleAll} />
                  {t('projects.import.selectAll')}
                </label>
              )}
              <span className="spacer" />
              <span className="muted">{t('projects.import.sortedBy')}</span>
            </div>

            <ul className="import-list">
              {rows.map((r) => {
                const id = rowId(r)
                const added = r.configuredIn !== null
                const on = !added && selected.has(id)
                const color = colorOf.get(id)
                return (
                  <li key={id} className={`import-row ${on ? 'on' : ''} ${added ? 'added' : ''}`}>
                    <label className="import-row-label">
                      <input
                        type="checkbox"
                        checked={added || on}
                        disabled={added}
                        onChange={() => toggle(id)}
                        aria-label={`${r.key} ${r.name}`}
                      />
                      <span
                        className="import-swatch"
                        aria-hidden="true"
                        style={color ? ({ '--swatch': color } as CSSProperties) : undefined}
                      />
                      <span className="import-row-main">
                        <span className="import-row-title">
                          <span className="import-key mono">{r.key}</span>
                          <span className="import-name">{r.name}</span>
                        </span>
                        <span className="import-row-meta">
                          {connections.length > 1 && (
                            <>
                              <span>{connectionName(r.connectionId)}</span>
                              <span aria-hidden="true">·</span>
                            </>
                          )}
                          <span>{t('projects.import.entries', { count: r.entries })}</span>
                          {added && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="import-added">
                                <Icon name="check" size={12} />
                                {t('projects.import.alreadyIn', { name: r.configuredIn })}
                              </span>
                            </>
                          )}
                        </span>
                      </span>
                    </label>
                    <span className="import-row-hours">
                      <strong>
                        {formatHours(r.seconds)}
                        <small> h</small>
                      </strong>
                      <span className="import-bar">
                        <span
                          style={{
                            width: `${Math.max(3, Math.round((r.seconds / maxSeconds) * 100))}%`,
                            background: added ? undefined : (color ?? 'var(--muted)')
                          }}
                        />
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </Modal>
  )
}
