import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addMonths, format } from 'date-fns'
import type {
  AppError,
  ReportColumnKey,
  ReportGroupKey,
  ReportLayout,
  ReportOrientation,
  ReportResult,
  ReportTimeFormat
} from '@shared/domain'
import {
  formatReportFilename,
  validateReportFilenameTemplate
} from '@shared/reportFilename'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { HelpTip } from '@/components/common/HelpTip'
import { Icon } from '@/components/common/Icon'
import { useAppStore } from '@/store/appStore'
import { dateLocale } from '@/utils/format'
import './reports.css'

/** Accent colours offered as swatches; any other comes from the colour picker. */
const ACCENTS = ['#172b4d', '#0052cc', '#2b2e36', '#0f766e', '#c2410c']

function toMonthValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function currentMonth(): string {
  return toMonthValue(new Date())
}

export function ReportsView(): JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = dateLocale(i18n.language)
  const config = useAppStore((state) => state.config)
  const saveConfig = useAppStore((state) => state.saveConfig)
  const requestedMonth = useAppStore((state) => state.reportMonth)
  const defaults = config.reports
  const [month, setMonth] = useState(requestedMonth ?? currentMonth)
  const [layout, setLayout] = useState<ReportLayout>(defaults.defaultLayout)
  const [groupings, setGroupings] = useState<ReportGroupKey[]>(defaults.defaultGroupings)
  const [columns, setColumns] = useState<ReportColumnKey[]>(defaults.defaultColumns)
  const [timeFormat, setTimeFormat] = useState<ReportTimeFormat>(defaults.defaultTimeFormat)
  const [orientation, setOrientation] = useState<ReportOrientation>(defaults.defaultOrientation)
  const [includeSummary, setIncludeSummary] = useState(defaults.includeSummary)
  const [accentColor, setAccentColor] = useState(defaults.accentColor)
  const [title, setTitle] = useState(defaults.title)
  const [filenameTemplate, setFilenameTemplate] = useState(defaults.filenameTemplate)
  const [showGeneratedAt, setShowGeneratedAt] = useState(defaults.showGeneratedAt)
  const [showPageNumbers, setShowPageNumbers] = useState(defaults.showPageNumbers)
  const [connectionIds, setConnectionIds] = useState<string[]>(() => {
    const active = config.activeConnectionIds.filter((id) =>
      config.connections.some((connection) => connection.id === id)
    )
    return active.length > 0 ? active : config.connections.map((connection) => connection.id)
  })
  const [projectIds, setProjectIds] = useState<string[]>(() =>
    config.projects.map((project) => project.id)
  )
  // Which preset the builder matches; any manual change makes it "custom".
  const [preset, setPreset] = useState<'tempo' | 'detailed' | 'custom'>('custom')
  const [generating, setGenerating] = useState(false)
  const [savedDefaults, setSavedDefaults] = useState(false)
  const [result, setResult] = useState<ReportResult | null>(null)
  const [error, setError] = useState<AppError | null>(null)

  const visibleProjects = useMemo(
    () =>
      config.projects.filter((project) =>
        project.targets.some((target) => connectionIds.includes(target.connectionId))
      ),
    [config.projects, connectionIds]
  )
  const availableCustomFields = useMemo(
    () => config.customFields,
    [config.customFields]
  )
  const allVisibleProjectsSelected =
    visibleProjects.length > 0 && visibleProjects.every((project) => projectIds.includes(project.id))
  const formattedHours = useMemo(
    () => (result ? (result.totalSeconds / 3600).toFixed(2).replace(/\.00$/, '') : ''),
    [result]
  )
  const filenameTemplateError = useMemo(
    () => validateReportFilenameTemplate(filenameTemplate),
    [filenameTemplate]
  )
  const filenamePreview = useMemo(() => {
    if (filenameTemplateError || !month) return ''
    try {
      return formatReportFilename(filenameTemplate, month, layout)
    } catch {
      return ''
    }
  }, [filenameTemplate, filenameTemplateError, layout, month])
  const filenameErrorText = filenameTemplateError
    ? t(`reports.filenameError.${filenameTemplateError}`)
    : ''

  const groupingOptions: Array<{ key: ReportGroupKey; label: string }> = [
    { key: 'project', label: t('reports.groupProject') },
    { key: 'issue', label: t('reports.groupIssue') },
    { key: 'day', label: t('reports.groupDay') },
    { key: 'worklog', label: t('reports.groupWorklog') },
    { key: 'connection', label: t('reports.groupConnection') },
    ...availableCustomFields.map((field) => ({
      key: `custom:${field.id}` as ReportGroupKey,
      label: `${t('reports.groupCustomField')}: ${field.label} · ${
        config.connections.find((connection) => connection.id === field.connectionId)?.name ?? ''
      }`
    }))
  ]

  const columnOptions: Array<{ key: ReportColumnKey; label: string }> = [
    { key: 'date', label: t('reports.columnDate') },
    { key: 'project', label: t('reports.groupProject') },
    { key: 'issue', label: t('reports.groupIssue') },
    { key: 'description', label: t('reports.columnDescription') },
    { key: 'connection', label: t('reports.groupConnection') },
    ...availableCustomFields.map((field) => ({
      key: `custom:${field.id}` as ReportColumnKey,
      label: `${field.label} · ${
        config.connections.find((connection) => connection.id === field.connectionId)?.name ?? ''
      }`
    }))
  ]

  const groupingLabel = (key: ReportGroupKey): string =>
    groupingOptions.find((option) => option.key === key)?.label ??
    config.customFields.find((field) => `custom:${field.id}` === key)?.label ??
    key

  const columnLabel = (key: ReportColumnKey): string =>
    columnOptions.find((option) => option.key === key)?.label ?? key

  const toggleConnection = (id: string): void =>
    setConnectionIds((selected) =>
      selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]
    )

  const toggleProject = (id: string): void =>
    setProjectIds((selected) =>
      selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]
    )

  const addGrouping = (): void => {
    const next = groupingOptions.find((option) => !groupings.includes(option.key))
    if (next && groupings.length < 5) setGroupings([...groupings, next.key])
  }

  const replaceGrouping = (index: number, key: ReportGroupKey): void =>
    setGroupings((current) => current.map((value, item) => (item === index ? key : value)))

  const moveGrouping = (index: number, offset: -1 | 1): void =>
    setGroupings((current) => {
      const target = index + offset
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const toggleColumn = (key: ReportColumnKey): void =>
    setColumns((current) =>
      current.includes(key) ? current.filter((column) => column !== key) : [...current, key]
    )

  const applyTempoPreset = (): void => {
    const custom = availableCustomFields[0]
    setPreset('tempo')
    setLayout('summary')
    setGroupings([
      ...(custom ? ([`custom:${custom.id}`] as ReportGroupKey[]) : []),
      'project',
      'issue'
    ])
    setColumns(['date', 'issue', 'description'])
    setTimeFormat('hours')
    setOrientation('portrait')
    setIncludeSummary(false)
    setAccentColor('#172b4d')
    setTitle('')
    setShowGeneratedAt(true)
    setShowPageNumbers(true)
  }

  const applyDetailedPreset = (): void => {
    setPreset('detailed')
    setLayout('detailed')
    setGroupings(['project'])
    setColumns(['date', 'issue', 'description', 'connection'])
    setTimeFormat('hours-minutes')
    setOrientation('landscape')
    setIncludeSummary(true)
    setAccentColor('#0052cc')
    setTitle(t('reports.defaultDetailedTitle'))
    setShowGeneratedAt(true)
    setShowPageNumbers(true)
  }

  const saveAsDefault = async (): Promise<void> => {
    const firstBase = groupings.find((key) => !key.startsWith('custom:'))
    const saved = await saveConfig({
      ...config,
      reports: {
        ...config.reports,
        defaultGrouping:
          firstBase === 'project' ||
          firstBase === 'issue' ||
          firstBase === 'day' ||
          firstBase === 'connection'
            ? firstBase
            : 'none',
        defaultLayout: layout,
        defaultGroupings: groupings,
        defaultColumns: columns,
        defaultTimeFormat: timeFormat,
        defaultOrientation: orientation,
        includeSummary,
        accentColor,
        title,
        filenameTemplate,
        showGeneratedAt,
        showPageNumbers
      }
    })
    if (saved.ok) {
      setSavedDefaults(true)
      setTimeout(() => setSavedDefaults(false), 2200)
    } else {
      setError(saved.error)
    }
  }

  const changeOutputDirectory = async (): Promise<void> => {
    const path = await window.api.dialog.pickFolder()
    if (!path) return
    const saved = await saveConfig({
      ...config,
      reports: { ...config.reports, outputDirectory: path }
    })
    if (!saved.ok) setError(saved.error)
  }

  const generate = async (): Promise<void> => {
    if (!month || connectionIds.length === 0) return
    setGenerating(true)
    setError(null)
    setResult(null)
    const allProjects = projectIds.length === config.projects.length
    const generated = await window.api.reports.generate({
      month,
      connectionIds,
      projectIds: allProjects ? [] : projectIds,
      layout,
      filenameTemplate,
      groupings,
      columns,
      timeFormat,
      orientation,
      includeSummary,
      accentColor,
      title,
      showGeneratedAt,
      showPageNumbers
    })
    setGenerating(false)
    if (generated.ok) {
      setResult(generated.value)
      window.dispatchEvent(new Event('reports-generated'))
    } else {
      setError(generated.error)
    }
  }

  const markCustom = (): void => setPreset('custom')
  const monthDate = new Date(`${month || currentMonth()}-01T00:00:00`)
  const shiftMonth = (offset: number): void => setMonth(toMonthValue(addMonths(monthDate, offset)))
  const outputDirectory = config.reports.outputDirectory || t('reports.defaultOutputDirectoryShort')

  return (
    <div className="report-screen">
      <section className="report-builder-pane" aria-label={t('reports.title')}>
        <header className="report-head">
          <h1 className="page-title">{t('reports.title')}</h1>
          <div className="segmented" role="group" aria-label={t('reports.preset')}>
            <button className={preset === 'tempo' ? 'active' : ''} onClick={applyTempoPreset}>
              {t('reports.presetTempo')}
            </button>
            <button className={preset === 'detailed' ? 'active' : ''} onClick={applyDetailedPreset}>
              {t('reports.presetDetailed')}
            </button>
            <button className={preset === 'custom' ? 'active' : ''} onClick={markCustom}>
              {t('reports.presetCustom')}
            </button>
          </div>
        </header>

        {error && <ErrorBanner error={error} />}

        <div className="report-group">
          <h2 className="eyebrow">{t('reports.sectionScope')}</h2>
          <div className="report-rows">
            <span className="report-label">{t('reports.month')}</span>
            <div className="report-month">
              <button className="btn btn-ghost btn-icon" onClick={() => shiftMonth(-1)} aria-label={t('calendar.previousMonth')}>
                <Icon name="chevronLeft" />
              </button>
              <span>{format(monthDate, 'LLLL yyyy', { locale })}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => shiftMonth(1)} aria-label={t('calendar.nextMonth')}>
                <Icon name="chevronRight" />
              </button>
            </div>

            <span className="report-label">{t('reports.connections')}</span>
            <div className="chip-list">
              {config.connections.map((connection) => (
                <button
                  key={connection.id}
                  className={`chip ${connectionIds.includes(connection.id) ? 'selected' : ''}`}
                  aria-pressed={connectionIds.includes(connection.id)}
                  onClick={() => toggleConnection(connection.id)}
                >
                  {connection.name || connection.jira.baseUrl}
                </button>
              ))}
            </div>

            {visibleProjects.length > 0 && (
              <>
                <span className="report-label">{t('reports.projects')}</span>
                <div className="chip-list">
                  <button
                    className={`chip ${allVisibleProjectsSelected ? 'selected' : ''}`}
                    aria-pressed={allVisibleProjectsSelected}
                    onClick={() => {
                      const visible = new Set(visibleProjects.map((project) => project.id))
                      setProjectIds((current) =>
                        allVisibleProjectsSelected
                          ? current.filter((id) => !visible.has(id))
                          : [...new Set([...current, ...visible])]
                      )
                    }}
                  >
                    {t('reports.allProjects')}
                  </button>
                  {visibleProjects.map((project) => (
                    <button
                      key={project.id}
                      className={`chip ${projectIds.includes(project.id) ? 'selected' : ''}`}
                      aria-pressed={projectIds.includes(project.id)}
                      onClick={() => toggleProject(project.id)}
                    >
                      <span className="chip-dot" style={{ background: project.color }} />
                      {project.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="report-group">
          <div className="report-group-head">
            <h2 className="eyebrow">
              {t('reports.groupBy')}
              <HelpTip label={t('reports.groupBy')}>{t('reports.groupHierarchyHint')}</HelpTip>
            </h2>
            <div className="segmented" role="group" aria-label={t('reports.layout')}>
              <button
                className={layout === 'summary' ? 'active' : ''}
                title={t('reports.layoutSummaryHint')}
                onClick={() => {
                  markCustom()
                  setLayout('summary')
                }}
              >
                {t('reports.layoutSummary')}
              </button>
              <button
                className={layout === 'detailed' ? 'active' : ''}
                title={t('reports.layoutDetailedHint')}
                onClick={() => {
                  markCustom()
                  setLayout('detailed')
                }}
              >
                {t('reports.layoutDetailed')}
              </button>
            </div>
          </div>

          {groupings.length === 0 && <p className="hint">{t('reports.noGrouping')}</p>}
          {groupings.map((grouping, index) => (
            <div key={`${grouping}-${index}`} className="report-level">
              <span className="mono report-level-index">{index + 1}</span>
              <select
                value={grouping}
                onChange={(event) => {
                  markCustom()
                  replaceGrouping(index, event.target.value as ReportGroupKey)
                }}
              >
                {groupingOptions
                  .filter((option) => option.key === grouping || !groupings.includes(option.key))
                  .map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
              </select>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => {
                  markCustom()
                  moveGrouping(index, -1)
                }}
                disabled={index === 0}
                aria-label={t('reports.moveUp')}
                title={t('reports.moveUp')}
              >
                ↑
              </button>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => {
                  markCustom()
                  moveGrouping(index, 1)
                }}
                disabled={index === groupings.length - 1}
                aria-label={t('reports.moveDown')}
                title={t('reports.moveDown')}
              >
                ↓
              </button>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => {
                  markCustom()
                  setGroupings((current) => current.filter((_, item) => item !== index))
                }}
                aria-label={t('reports.removeGrouping')}
                title={t('reports.removeGrouping')}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
          <button
            className="link report-add-level"
            onClick={() => {
              markCustom()
              addGrouping()
            }}
            disabled={groupings.length >= Math.min(5, groupingOptions.length)}
          >
            + {t('reports.addGrouping')}
          </button>

          {layout === 'detailed' && (
            <>
              <span className="report-label">{t('reports.columns')}</span>
              <div className="chip-list">
                {columnOptions.map((option) => (
                  <button
                    key={option.key}
                    className={`chip ${columns.includes(option.key) ? 'selected' : ''}`}
                    aria-pressed={columns.includes(option.key)}
                    onClick={() => {
                      markCustom()
                      toggleColumn(option.key)
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="report-group">
          <h2 className="eyebrow">{t('reports.sectionDocument')}</h2>
          <div className="report-rows">
            <label className="report-label" htmlFor="report-title">
              {t('reports.reportTitle')}
            </label>
            <input
              id="report-title"
              value={title}
              onChange={(event) => {
                markCustom()
                setTitle(event.target.value)
              }}
              placeholder={t('reports.reportTitlePlaceholder')}
            />

            <span className="report-label">{t('reports.timeFormat')}</span>
            <div className="segmented" role="group" aria-label={t('reports.timeFormat')}>
              <button
                className={`mono ${timeFormat === 'hours' ? 'active' : ''}`}
                title={t('reports.timeDecimal')}
                onClick={() => {
                  markCustom()
                  setTimeFormat('hours')
                }}
              >
                7.5
              </button>
              <button
                className={`mono ${timeFormat === 'hours-minutes' ? 'active' : ''}`}
                title={t('reports.timeHoursMinutes')}
                onClick={() => {
                  markCustom()
                  setTimeFormat('hours-minutes')
                }}
              >
                7:30
              </button>
            </div>

            <span className="report-label">{t('reports.orientation')}</span>
            <div className="segmented" role="group" aria-label={t('reports.orientation')}>
              {(['portrait', 'landscape'] as ReportOrientation[]).map((value) => (
                <button
                  key={value}
                  className={orientation === value ? 'active' : ''}
                  onClick={() => {
                    markCustom()
                    setOrientation(value)
                  }}
                >
                  {t(value === 'portrait' ? 'reports.orientationPortrait' : 'reports.orientationLandscape')}
                </button>
              ))}
            </div>

            <span className="report-label">{t('reports.accentColor')}</span>
            <div className="swatches">
              {ACCENTS.map((color) => (
                <button
                  key={color}
                  className={`swatch ${accentColor.toLowerCase() === color ? 'selected' : ''}`}
                  style={{ background: color }}
                  aria-label={color}
                  aria-pressed={accentColor.toLowerCase() === color}
                  onClick={() => {
                    markCustom()
                    setAccentColor(color)
                  }}
                />
              ))}
              <label
                className={`swatch swatch-custom ${ACCENTS.includes(accentColor.toLowerCase()) ? '' : 'selected'}`}
                title={t('projects.colorHint')}
              >
                <input
                  type="color"
                  value={accentColor}
                  onChange={(event) => {
                    markCustom()
                    setAccentColor(event.target.value)
                  }}
                />
              </label>
            </div>

            <span className="report-label">{t('reports.extras')}</span>
            <div className="report-switches">
              {(
                [
                  ['reports.includeSummary', includeSummary, setIncludeSummary],
                  ['reports.showGeneratedAt', showGeneratedAt, setShowGeneratedAt],
                  ['reports.showPageNumbers', showPageNumbers, setShowPageNumbers]
                ] as Array<[string, boolean, (value: boolean) => void]>
              ).map(([key, checked, set]) => (
                <label key={key} className="switch">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      markCustom()
                      set(event.target.checked)
                    }}
                  />
                  {t(key)}
                </label>
              ))}
            </div>

            <label className="report-label" htmlFor="report-filename">
              {t('reports.filenameTemplate')}
              <HelpTip label={t('reports.filenameTemplate')}>
                {t('reports.filenameTokens')} <code>{'{MM}'}</code> <code>{'{YYYY}'}</code>{' '}
                <code>{'{YYYY-MM}'}</code> <code>{'{layout}'}</code>
              </HelpTip>
            </label>
            <div className={`report-filename ${filenameTemplateError ? 'invalid' : ''}`}>
              <input
                id="report-filename"
                className="mono"
                value={filenameTemplate}
                onChange={(event) => setFilenameTemplate(event.target.value)}
                placeholder="{MM}.{YYYY}.pdf"
                spellCheck={false}
                aria-invalid={filenameTemplateError ? 'true' : 'false'}
              />
              {filenameErrorText && <span className="report-field-error">{filenameErrorText}</span>}
            </div>
          </div>
        </div>

        {result && (
          <div className="banner banner-success reports-result">
            <Icon name="check" size={16} />
            <span className="reports-result-copy">
              <strong>{t('reports.generated')}</strong>
              <span>
                {t('reports.generatedSummary', { entries: result.entryCount, hours: formattedHours })}
              </span>
            </span>
            <button className="btn btn-sm" onClick={() => window.api.reports.reveal(result.filePath)}>
              {t('reports.showInFolder')}
            </button>
          </div>
        )}

        <footer className="report-footer">
          <div className="report-saves" title={`${outputDirectory} / ${filenamePreview}`}>
            <span className="muted">{t('reports.savesAs')}</span>
            <span className="mono">{filenamePreview || '—'}</span>
            <span className="muted report-saves-dir">{outputDirectory}</span>
            <button className="link" onClick={changeOutputDirectory}>
              {t('reports.changeOutput')}
            </button>
          </div>
          <div className="report-actions">
            <button className="btn btn-lg" onClick={saveAsDefault} disabled={Boolean(filenameTemplateError)}>
              {savedDefaults ? `✓ ${t('reports.defaultsSaved')}` : t('reports.saveDefaults')}
            </button>
            <button
              className="btn btn-primary btn-lg report-generate"
              onClick={generate}
              disabled={generating || !month || connectionIds.length === 0 || Boolean(filenameTemplateError)}
            >
              {generating && <span className="spinner" />}
              {generating ? t('reports.generating') : t('reports.generate')}
            </button>
          </div>
        </footer>
      </section>

      <section className="report-preview-pane" aria-label={t('reports.livePreview')}>
        <div className="report-preview-meta">
          <span>{t('reports.livePreview')}</span>
          <span>
            {orientation === 'portrait' ? t('reports.orientationPortrait') : t('reports.orientationLandscape')} · A4
          </span>
        </div>
        <div
          className={`report-paper-preview ${orientation}`}
          style={{ '--preview-accent': accentColor } as React.CSSProperties}
        >
          <div className="preview-top">
            <b>{title}</b>
            <span>
              Period: 01/Jun/26 - 30/Jun/26
              <br />
              Total Logged: <strong>168</strong>
            </span>
          </div>
          <div className="preview-rule" />
          {includeSummary && (
            <div className="preview-metrics">
              <i />
              <i />
              <i />
              <i />
            </div>
          )}
          {layout === 'summary' ? (
            <div className="preview-summary">
              <div className="preview-table-head">
                <span>{groupings.length > 0 ? groupings.map(groupingLabel).join(' / ') : t('reports.noGrouping')}</span>
                <b>Logged</b>
              </div>
              {(groupings.length > 0 ? groupings : ['project' as ReportGroupKey]).map((grouping, index) => (
                <div key={`${grouping}-${index}`} className={`preview-group-line depth-${Math.min(index, 3)}`}>
                  <span>
                    {grouping.startsWith('custom:')
                      ? index === 0
                        ? groupingLabel(grouping).replace(`${t('reports.groupCustomField')}: `, '')
                        : 'Custom value'
                      : grouping === 'project'
                        ? 'Project Alpha (PRJ)'
                        : grouping === 'issue'
                          ? 'PRJ-123 - Example work item'
                          : grouping === 'day'
                            ? '2026-06-15'
                            : grouping === 'worklog'
                              ? t('reports.previewWorklog')
                              : 'Company Jira'}
                  </span>
                  <b>{Math.max(8, 168 - index * 40)}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="preview-detail">
              <div className="preview-detail-head">
                {columns.slice(0, 4).map((column) => (
                  <span key={column}>{columnLabel(column)}</span>
                ))}
                <b>Logged</b>
              </div>
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="preview-detail-row">
                  {columns.slice(0, 4).map((column) => (
                    <i key={column} />
                  ))}
                  <b>{row % 2 ? '3:00' : '5:00'}</b>
                </div>
              ))}
            </div>
          )}
          {(showGeneratedAt || showPageNumbers) && (
            <div className="preview-footer">
              <span>{showGeneratedAt ? '2026-06-30 16:20' : ''}</span>
              <span>{showPageNumbers ? 'Page 1 of 1' : ''}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
