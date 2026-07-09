import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek
} from 'date-fns'
import type { AppError, Worklog } from '@shared/domain'
import { useAppStore } from '@/store/appStore'
import { toIsoDate } from '@/utils/format'

/** A Tempo worklog tagged with the connection and matched project. */
export interface CalendarEntry extends Worklog {
  connectionId: string
  connectionName: string
  /** Color of the matched configured project; '' = no match. */
  projectColor: string
  projectName: string
  /** Icons of custom fields marked "show in calendar" with a truthy value. */
  fieldIcons: string[]
}

/** A field marks an entry when its stored value is meaningfully set. */
function isTruthyAttribute(type: 'string' | 'boolean', value: string | boolean | undefined): boolean {
  if (value === undefined) return false
  if (type === 'boolean') return value === true || value === 'true'
  return typeof value === 'string' && value.trim() !== '' && value !== 'false'
}

export interface CalendarState {
  month: Date
  /** All days of the visible grid (full weeks covering the month). */
  days: Date[]
  worklogsByDate: Map<string, CalendarEntry[]>
  /** Current selection; during a drag it previews the dragged range. */
  selected: Set<string>
  loading: boolean
  error: AppError | null
  goToMonth(offset: number): void
  goToToday(): void
  onDayMouseDown(date: Date): void
  onDayMouseEnter(date: Date): void
  clearSelection(): void
  reload(): void
}

/** Continuous ISO date range between two ISO dates, in either order. */
function isoRange(a: string, b: string): string[] {
  const [from, to] = [a, b].sort()
  return eachDayOfInterval({ start: new Date(from), end: new Date(to) }).map(toIsoDate)
}

/**
 * Calendar data + selection behaviour: a plain click opens the wizard for
 * that single day (via onQuickOpen), click-and-drag selects a range.
 * Worklogs are fetched from every active connection and merged.
 */
export function useCalendar(onQuickOpen: (dates: string[]) => void): CalendarState {
  const config = useAppStore((s) => s.config)
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [entries, setEntries] = useState<CalendarEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState<{ anchor: string; current: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [reloadCounter, setReloadCounter] = useState(0)

  const activeConnections = useMemo(
    () => config.connections.filter((c) => config.activeConnectionIds.includes(c.id)),
    [config.connections, config.activeConnectionIds]
  )

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [month])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      setLoading(true)
      setError(null)
      const from = toIsoDate(days[0])
      const to = toIsoDate(days[days.length - 1])

      const results = await Promise.all(
        activeConnections.map(async (connection) => ({
          connection,
          result: await window.api.tempo.getWorklogs(connection.id, from, to)
        }))
      )
      if (cancelled) return
      setLoading(false)

      const merged: CalendarEntry[] = []
      let firstError: AppError | null = null
      for (const { connection, result } of results) {
        if (result.ok) {
          merged.push(
            ...result.value.map((w) => {
              // Match through the targets: entries of one project coming from
              // different Jiras share the same color and name in the calendar.
              const project = config.projects.find((p) =>
                p.targets.some(
                  (t) =>
                    t.connectionId === connection.id &&
                    w.issueKey.startsWith(`${t.jiraProjectKey}-`)
                )
              )
              const attributeByKey = new Map(w.attributes.map((a) => [a.key, a.value]))
              const fieldIcons = config.customFields
                .filter(
                  (f) =>
                    f.connectionId === connection.id &&
                    f.showInCalendar &&
                    f.calendarIcon &&
                    isTruthyAttribute(f.type, attributeByKey.get(f.key))
                )
                .map((f) => f.calendarIcon)
              return {
                ...w,
                connectionId: connection.id,
                connectionName: connection.name || connection.jira.baseUrl,
                projectColor: project?.color ?? '',
                projectName: project?.name ?? '',
                fieldIcons
              }
            })
          )
        } else if (result.error.code !== 'CONFIG_INVALID') {
          // An unconfigured connection shows as empty, a broken one as an error.
          firstError = firstError ?? result.error
        }
      }
      setEntries(merged)
      setError(firstError)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [days, reloadCounter, activeConnections, config.projects, config.customFields])

  const worklogsByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>()
    for (const entry of entries) {
      const list = map.get(entry.startDate) ?? []
      list.push(entry)
      map.set(entry.startDate, list)
    }
    return map
  }, [entries])

  // Finish the drag on mouseup anywhere: one day -> open the wizard
  // immediately, a dragged range -> keep it selected for the toolbar action.
  useEffect(() => {
    if (!drag) return
    const onMouseUp = (): void => {
      const range = isoRange(drag.anchor, drag.current)
      setDrag(null)
      setSelected(new Set(range))
      if (range.length === 1) onQuickOpen(range)
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [drag, onQuickOpen])

  const onDayMouseDown = useCallback((date: Date): void => {
    const iso = toIsoDate(date)
    setDrag({ anchor: iso, current: iso })
  }, [])

  const onDayMouseEnter = useCallback((date: Date): void => {
    const iso = toIsoDate(date)
    setDrag((d) => (d && d.current !== iso ? { ...d, current: iso } : d))
  }, [])

  const visibleSelection = useMemo(
    () => (drag ? new Set(isoRange(drag.anchor, drag.current)) : selected),
    [drag, selected]
  )

  return {
    month,
    days,
    worklogsByDate,
    selected: visibleSelection,
    loading,
    error,
    goToMonth: (offset) => setMonth((m) => addMonths(m, offset)),
    goToToday: () => setMonth(startOfMonth(new Date())),
    onDayMouseDown,
    onDayMouseEnter,
    clearSelection: () => setSelected(new Set()),
    reload: () => setReloadCounter((c) => c + 1)
  }
}
