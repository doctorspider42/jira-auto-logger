import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatHours } from '@/utils/format'
import type { CalendarEntry } from './useCalendar'

interface Props {
  entries: CalendarEntry[]
  multipleActive: boolean
  onEditEntry: (entry: CalendarEntry) => void
  /** Open the day view so the hidden entries become reachable. */
  onShowMore: () => void
}

/** Vertical gap between entry chips, mirrored from `.calendar-day-entries` in calendar.css. */
const ENTRY_GAP = 2

/**
 * Measure how many uniform-height entry chips fit in the (flex-sized) tile.
 * When they overflow, one row is reserved for the "+N more" chip so the tally
 * itself always fits. Recomputes on any resize of the container.
 */
function useVisibleCount(ref: React.RefObject<HTMLElement>, total: number): number {
  const [visible, setVisible] = useState(total)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = (): void => {
      const first = el.firstElementChild as HTMLElement | null
      if (!first) return
      const rowHeight = first.offsetHeight
      if (rowHeight <= 0) return
      // How many rows (chip + gap) the available height can hold.
      const capacity = Math.floor((el.clientHeight + ENTRY_GAP) / (rowHeight + ENTRY_GAP))
      // When everything fits, show it all; otherwise give up one row to "+N more".
      const next = total <= capacity ? total : Math.max(0, capacity - 1)
      setVisible((prev) => (prev === next ? prev : next))
    }

    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => observer.disconnect()
  }, [ref, total])

  return Math.min(visible, total)
}

export function MonthDayEntries({ entries, multipleActive, onEditEntry, onShowMore }: Props): JSX.Element {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const visible = useVisibleCount(ref, entries.length)
  const hidden = entries.length - visible

  return (
    <div className="calendar-day-entries" ref={ref}>
      {entries.slice(0, visible).map((worklog) => (
        <div
          key={`${worklog.connectionId}-${worklog.tempoWorklogId}`}
          className="calendar-entry"
          role="button"
          style={
            worklog.projectColor
              ? ({ '--entry-color': worklog.projectColor } as React.CSSProperties)
              : undefined
          }
          title={`[${worklog.projectName || worklog.connectionName}] ${worklog.issueKey} ${worklog.issueSummary}\n${worklog.description}\n— ${t('calendar.editor.editHint')}`}
          // Stop the click from starting a day drag/selection.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onEditEntry(worklog)}
        >
          <span className="calendar-entry-key">
            {multipleActive && (
              <span className="calendar-entry-conn">
                {(worklog.connectionName || '?').charAt(0).toUpperCase()}
              </span>
            )}
            {worklog.issueKey}
          </span>
          {worklog.fieldIcons.length > 0 && (
            <span className="calendar-entry-icons">{worklog.fieldIcons.join('')}</span>
          )}
          <span className="calendar-entry-hours">
            {formatHours(worklog.timeSpentSeconds)}
            {t('app.hoursShort')}
          </span>
        </div>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          className="calendar-entry-more"
          title={t('calendar.openDay')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onShowMore()
          }}
        >
          {t('calendar.moreEntries', { count: hidden })}
        </button>
      )}
    </div>
  )
}
