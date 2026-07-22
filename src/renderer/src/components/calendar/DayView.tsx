import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { isToday } from 'date-fns'
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

/**
 * Turn a day's worklogs into positioned blocks. With several Jiras active each
 * connection gets its own fixed column (they log the same day independently, so
 * mixing them across columns by mere time-overlap is confusing); within a single
 * connection overlapping blocks are still split into columns.
 */
function layoutEntries(entries: CalendarEntry[], splitByConnection: boolean): PositionedEntry[] {
  if (!splitByConnection) return packOverlaps(placeEntries(entries))

  // One column per connection, ordered stably so left/right stay put day to day.
  const byConnection = new Map<string, CalendarEntry[]>()
  for (const entry of entries) {
    const list = byConnection.get(entry.connectionId) ?? []
    list.push(entry)
    byConnection.set(entry.connectionId, list)
  }
  const connectionIds = [...byConnection.keys()].sort()
  const cols = connectionIds.length
  const result: PositionedEntry[] = []
  connectionIds.forEach((connectionId, col) => {
    for (const placed of placeEntries(byConnection.get(connectionId) ?? [])) {
      result.push({ ...placed, col, cols })
    }
  })
  return result
}

interface DayViewProps {
  day: Date
  entries: CalendarEntry[]
  multipleActive: boolean
  onEditEntry: (entry: CalendarEntry) => void
  /** When set, entries it rejects are dimmed and matches are emphasised. */
  matchEntry?: (entry: CalendarEntry) => boolean
}

export function DayView({
  day,
  entries,
  multipleActive,
  onEditEntry,
  matchEntry
}: DayViewProps): JSX.Element {
  const { t } = useTranslation()
  const positioned = useMemo(
    () => layoutEntries(entries, multipleActive),
    [entries, multipleActive]
  )

  const { startHour, endHour } = useMemo(() => {
    const from = positioned.reduce((min, p) => Math.min(min, p.start), MIN_HOUR * 3600)
    const to = positioned.reduce((max, p) => Math.max(max, p.end), MAX_HOUR * 3600)
    return {
      startHour: Math.max(0, Math.min(MIN_HOUR, Math.floor(from / 3600))),
      endHour: Math.min(24, Math.max(MAX_HOUR, Math.ceil(to / 3600)))
    }
  }, [positioned])

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const gridHeight = (endHour - startHour) * HOUR_HEIGHT
  const secToTop = (sec: number): number => ((sec - startHour * 3600) / 3600) * HOUR_HEIGHT

  // Live "now" marker, only while looking at the actual current day.
  const now = new Date()
  const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60
  const showNow = isToday(day) && nowSeconds >= startHour * 3600 && nowSeconds <= endHour * 3600

  return (
    <div className="day-view">
      <div className="day-grid" style={{ height: gridHeight }}>
        {hours.map((hour, i) => (
          <div key={hour} className="day-hour-row" style={{ top: i * HOUR_HEIGHT }}>
            <span className="day-hour-label">{String(hour).padStart(2, '0')}:00</span>
            <span className="day-hour-line" />
          </div>
        ))}

        {showNow && (
          <div className="day-now" style={{ top: secToTop(nowSeconds) }}>
            <span className="day-now-dot" />
          </div>
        )}

        <div className="day-entries" style={{ left: 52 }}>
          {positioned.map((p) => {
            const top = secToTop(p.start)
            const height = Math.max(18, (p.entry.timeSpentSeconds / 3600) * HOUR_HEIGHT - 2)
            const width = `calc((100% - 8px) / ${p.cols})`
            const left = `calc((100% - 8px) / ${p.cols} * ${p.col})`
            const worklog = p.entry
            return (
              <div
                key={`${worklog.connectionId}-${worklog.tempoWorklogId}`}
                className={`day-entry ${matchEntry ? (matchEntry(worklog) ? 'matched' : 'dimmed') : ''}`}
                role="button"
                style={{
                  top,
                  height,
                  width,
                  left,
                  ...(worklog.projectColor
                    ? ({ '--entry-color': worklog.projectColor } as React.CSSProperties)
                    : {})
                }}
                title={`[${worklog.projectName || worklog.connectionName}] ${worklog.issueKey} ${worklog.issueSummary}\n${worklog.description}\n— ${t('calendar.editor.editHint')}`}
                onClick={() => onEditEntry(worklog)}
              >
                <div className="day-entry-head">
                  <span className="day-entry-key">
                    {multipleActive && (
                      <span className="calendar-entry-conn">
                        {(worklog.connectionName || '?').charAt(0).toUpperCase()}
                      </span>
                    )}
                    {worklog.issueKey}
                  </span>
                  <span className="day-entry-hours">
                    {worklog.fieldIcons.length > 0 && (
                      <span className="calendar-entry-icons">{worklog.fieldIcons.join('')}</span>
                    )}
                    {formatHours(worklog.timeSpentSeconds)}
                    {t('app.hoursShort')}
                  </span>
                </div>
                {worklog.issueSummary && (
                  <span className="day-entry-summary">{worklog.issueSummary}</span>
                )}
                {worklog.description && height > 44 && (
                  <span className="day-entry-desc">{worklog.description}</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
