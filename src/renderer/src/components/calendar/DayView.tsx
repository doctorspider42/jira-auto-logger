import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { isToday } from 'date-fns'
import type { JiraConnection } from '@shared/domain'
import { formatHours } from '@/utils/format'
import type { CalendarEntry } from './useCalendar'

/** Pixel height of one hour row in the day timeline. */
const HOUR_HEIGHT = 56
/** The timeline always covers at least this window, expanding to fit entries. */
const MIN_HOUR = 8
const MAX_HOUR = 18

interface PositionedEntry {
  entry: CalendarEntry
  /** Seconds from midnight. */
  start: number
  end: number
  /** Column index and column count for side-by-side overlapping entries. */
  col: number
  cols: number
}

/** "HH:MM:SS" -> seconds from midnight, or null when absent/malformed. */
function parseStartSeconds(value: string | undefined): number | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0)
}

type PlacedEntry = Omit<PositionedEntry, 'col' | 'cols'>

/**
 * Give each entry a vertical position: entries carrying a Tempo start time
 * keep it, the rest stack back-to-back after them (mirroring how this app
 * lays out new entries).
 */
function placeEntries(entries: CalendarEntry[]): PlacedEntry[] {
  const timed: Array<{ entry: CalendarEntry; start: number }> = []
  const untimed: CalendarEntry[] = []
  for (const entry of entries) {
    const start = parseStartSeconds(entry.startTime)
    if (start === null) untimed.push(entry)
    else timed.push({ entry, start })
  }
  timed.sort((a, b) => a.start - b.start)

  const positioned: PlacedEntry[] = timed.map((t) => ({
    entry: t.entry,
    start: t.start,
    end: t.start + t.entry.timeSpentSeconds
  }))
  let cursor = positioned.reduce((max, p) => Math.max(max, p.end), MIN_HOUR * 3600)
  for (const entry of untimed) {
    positioned.push({ entry, start: cursor, end: cursor + entry.timeSpentSeconds })
    cursor += entry.timeSpentSeconds
  }
  return positioned
}

/** Pack overlapping blocks into side-by-side columns, one cluster at a time. */
function packOverlaps(positioned: PlacedEntry[]): PositionedEntry[] {
  positioned.sort((a, b) => a.start - b.start || a.end - b.end)
  const result: PositionedEntry[] = []
  let cluster: PositionedEntry[] = []
  let clusterEnd = -1
  const flush = (): void => {
    const total = Math.max(...cluster.map((c) => c.col + 1), 1)
    for (const c of cluster) c.cols = total
    result.push(...cluster)
    cluster = []
  }
  for (const p of positioned) {
    if (cluster.length > 0 && p.start >= clusterEnd) flush()
    let col = 0
    while (cluster.some((c) => c.col === col && c.end > p.start)) col++
    cluster.push({ ...p, col, cols: 1 })
    clusterEnd = Math.max(clusterEnd, p.end)
  }
  if (cluster.length > 0) flush()
  return result
}

interface DayViewProps {
  day: Date
  entries: CalendarEntry[]
  /** Active connections; each gets its own lane, so a day logged to two Jiras reads as two days. */
  connections: JiraConnection[]
  workingHoursPerDay: number
  onEditEntry: (entry: CalendarEntry) => void
  /** When set, entries it rejects are dimmed and matches are emphasised. */
  matchEntry?: (entry: CalendarEntry) => boolean
}

export function DayView({
  day,
  entries,
  connections,
  workingHoursPerDay,
  onEditEntry,
  matchEntry
}: DayViewProps): JSX.Element {
  const { t } = useTranslation()
  const lanes = useMemo(
    () =>
      connections.map((connection) => {
        const laneEntries = entries.filter((e) => e.connectionId === connection.id)
        return {
          connection,
          seconds: laneEntries.reduce((sum, e) => sum + e.timeSpentSeconds, 0),
          // Within one Jira, overlapping blocks still split into columns.
          positioned: packOverlaps(placeEntries(laneEntries))
        }
      }),
    [connections, entries]
  )

  const { startHour, endHour } = useMemo(() => {
    const all = lanes.flatMap((lane) => lane.positioned)
    const from = all.reduce((min, p) => Math.min(min, p.start), MIN_HOUR * 3600)
    const to = all.reduce((max, p) => Math.max(max, p.end), MAX_HOUR * 3600)
    return {
      startHour: Math.max(0, Math.min(MIN_HOUR, Math.floor(from / 3600))),
      endHour: Math.min(24, Math.max(MAX_HOUR, Math.ceil(to / 3600)))
    }
  }, [lanes])

  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)
  const gridHeight = (endHour - startHour) * HOUR_HEIGHT
  const secToTop = (sec: number): number => ((sec - startHour * 3600) / 3600) * HOUR_HEIGHT

  // Live "now" marker, only while looking at the actual current day.
  const now = new Date()
  const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60
  const showNow = isToday(day) && nowSeconds >= startHour * 3600 && nowSeconds <= endHour * 3600

  return (
    <div className="day-view">
      <div className="day-lanes-head" style={{ gridTemplateColumns: `56px repeat(${lanes.length}, minmax(0, 1fr))` }}>
        <span />
        {lanes.map((lane) => (
          <div key={lane.connection.id} className="day-lane-head">
            <span className="day-lane-name">{lane.connection.name || lane.connection.jira.baseUrl}</span>
            <span className="mono muted">
              {formatHours(lane.seconds)} / {workingHoursPerDay}
              {t('app.hoursShort')}
            </span>
          </div>
        ))}
      </div>
      <div className="day-grid" style={{ gridTemplateColumns: `56px repeat(${lanes.length}, minmax(0, 1fr))` }}>
        <div className="day-hours" style={{ height: gridHeight }}>
          {hours.map((hour, i) => (
            <span key={hour} className="day-hour-label mono" style={{ top: i * HOUR_HEIGHT }}>
              {String(hour).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {lanes.map((lane) => (
          <div
            key={lane.connection.id}
            className="day-lane"
            style={{ height: gridHeight, backgroundSize: `100% ${HOUR_HEIGHT}px` }}
          >
            {showNow && <div className="day-now" style={{ top: secToTop(nowSeconds) }} />}
            {lane.positioned.map((p) => {
              const top = secToTop(p.start)
              const height = Math.max(22, (p.entry.timeSpentSeconds / 3600) * HOUR_HEIGHT - 4)
              const worklog = p.entry
              return (
                <button
                  key={`${worklog.connectionId}-${worklog.tempoWorklogId}`}
                  className={`day-entry ${matchEntry ? (matchEntry(worklog) ? 'matched' : 'dimmed') : ''}`}
                  style={{
                    top: top + 2,
                    height,
                    width: `calc((100% - 12px) / ${p.cols})`,
                    left: `calc(6px + (100% - 12px) / ${p.cols} * ${p.col})`,
                    ...(worklog.projectColor
                      ? ({ '--entry-color': worklog.projectColor } as React.CSSProperties)
                      : {})
                  }}
                  title={`[${worklog.projectName || worklog.connectionName}] ${worklog.issueKey} ${worklog.issueSummary}
${worklog.description}
— ${t('calendar.editor.editHint')}`}
                  onClick={() => onEditEntry(worklog)}
                >
                  <span className="day-entry-head">
                    <span className="day-entry-key mono">{worklog.issueKey}</span>
                    <span className="day-entry-hours mono">
                      {worklog.fieldIcons.length > 0 && <span aria-hidden>{worklog.fieldIcons.join('')}</span>}
                      {formatHours(worklog.timeSpentSeconds)}
                      {t('app.hoursShort')}
                    </span>
                  </span>
                  {worklog.issueSummary && <span className="day-entry-summary">{worklog.issueSummary}</span>}
                  {worklog.description && height > 56 && (
                    <span className="day-entry-desc">{worklog.description}</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
