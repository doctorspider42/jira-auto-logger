import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { useAppStore } from '@/store/appStore'
import './reports.css'

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function ReportsView(): JSX.Element {
  const { t } = useTranslation()
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
  const allConnectionsSelected =
    connectionIds.length === config.connections.length && config.connections.length > 0
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

  return (
    <div className="reports reports-pro">
      <div className="reports-heading">
        <div>
          <span className="reports-kicker">{t('reports.builderKicker')}</span>
          <h2>{t('reports.title')}</h2>
          <p className="hint">{t('reports.hintPro')}</p>
        </div>
        <div className="reports-presets">
          <button className="btn" onClick={applyTempoPreset}>
            {t('reports.presetTempo')}
          </button>
          <button className="btn" onClick={applyDetailedPreset}>
            {t('reports.presetDetailed')}
          </button>
        </div>
      </div>

      {error && <ErrorBanner error={error} />}

      <div className="report-builder">
        <div className="report-builder-controls">
          <section className="card report-section">
            <div className="report-section-title">
              <span className="report-section-number">1</span>
              <div>
                <h3>{t('reports.sectionScope')}</h3>
                <p>{t('reports.sectionScopeHint')}</p>
              </div>
            </div>
            <div className="field">
              <label>{t('reports.month')}</label>
              <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            </div>
            <div className="field">
              <label>{t('reports.connections')}</label>
              <div className="reports-chip-grid">
                <label className="reports-select-chip reports-select-all">
                  <input
                    type="checkbox"
                    checked={allConnectionsSelected}
                    onChange={(event) =>
                      setConnectionIds(
                        event.target.checked
                          ? config.connections.map((connection) => connection.id)
                          : []
                      )
                    }
                  />
                  {t('reports.allConnections')}
                </label>
                {config.connections.map((connection) => (
                  <label key={connection.id} className="reports-select-chip">
                    <input
                      type="checkbox"
                      checked={connectionIds.includes(connection.id)}
                      onChange={() => toggleConnection(connection.id)}
                    />
                    {connection.name || connection.jira.baseUrl}
                  </label>
                ))}
              </div>
            </div>
            {visibleProjects.length > 0 && (
              <div className="field">
                <label>{t('reports.projects')}</label>
                <div className="reports-chip-grid">
                  <label className="reports-select-chip reports-select-all">
                    <input
                      type="checkbox"
                      checked={allVisibleProjectsSelected}
                      onChange={(event) => {
                        const visible = new Set(visibleProjects.map((project) => project.id))
                        setProjectIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, ...visible])]
                            : current.filter((id) => !visible.has(id))
                        )
                      }}
                    />
                    {t('reports.allProjects')}
                  </label>
                  {visibleProjects.map((project) => (
                    <label key={project.id} className="reports-select-chip">
                      <input
                        type="checkbox"
                        checked={projectIds.includes(project.id)}
                        onChange={() => toggleProject(project.id)}
                      />
                      <span className="report-project-dot" style={{ background: project.color }} />
                      {project.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="card report-section">
            <div className="report-section-title">
              <span className="report-section-number">2</span>
              <div>
                <h3>{t('reports.sectionStructure')}</h3>
                <p>{t('reports.sectionStructureHint')}</p>
              </div>
            </div>
            <div className="report-segmented">
              <button
                className={layout === 'summary' ? 'active' : ''}
                onClick={() => setLayout('summary')}
              >
                <strong>{t('reports.layoutSummary')}</strong>
                <span>{t('reports.layoutSummaryHint')}</span>
              </button>
              <button
                className={layout === 'detailed' ? 'active' : ''}
                onClick={() => setLayout('detailed')}
              >
                <strong>{t('reports.layoutDetailed')}</strong>
                <span>{t('reports.layoutDetailedHint')}</span>
              </button>
            </div>

            <div className="report-subsection-head">
              <div>
                <label>{t('reports.groupHierarchy')}</label>
                <span>{t('reports.groupHierarchyHint')}</span>
              </div>
              <button
                className="btn btn-sm"
                onClick={addGrouping}
                disabled={
                  groupings.length >= Math.min(5, groupingOptions.length) ||
                  groupingOptions.length === 0
                }
              >
                + {t('reports.addGrouping')}
              </button>
            </div>
            <div className="report-group-builder">
              {groupings.length === 0 && (
                <div className="report-empty-builder">{t('reports.noGrouping')}</div>
              )}
              {groupings.map((grouping, index) => (
                <div key={`${grouping}-${index}`} className="report-group-level">
                  <span className="report-level-index">{index + 1}</span>
                  <select
                    value={grouping}
                    onChange={(event) =>
                      replaceGrouping(index, event.target.value as ReportGroupKey)
                    }
                  >
                    {groupingOptions
                      .filter(
                        (option) => option.key === grouping || !groupings.includes(option.key)
                      )
                      .map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                  </select>
                  <div className="report-level-actions">
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => moveGrouping(index, -1)}
                      disabled={index === 0}
                      title={t('reports.moveUp')}
                    >
                      ↑
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => moveGrouping(index, 1)}
                      disabled={index === groupings.length - 1}
                      title={t('reports.moveDown')}
                    >
                      ↓
                    </button>
                    <button
                      className="btn btn-sm btn-ghost btn-danger"
                      onClick={() =>
                        setGroupings((current) => current.filter((_, item) => item !== index))
                      }
                      title={t('reports.removeGrouping')}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {layout === 'detailed' && (
              <>
                <div className="report-subsection-head">
                  <div>
                    <label>{t('reports.columns')}</label>
                    <span>{t('reports.columnsHint')}</span>
                  </div>
                </div>
                <div className="report-column-picker">
                  {columnOptions.map((option) => (
                    <label key={option.key} className="report-column-chip">
                      <input
                        type="checkbox"
                        checked={columns.includes(option.key)}
                        onChange={() => toggleColumn(option.key)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="card report-section">
            <div className="report-section-title">
              <span className="report-section-number">3</span>
              <div>
                <h3>{t('reports.sectionAppearance')}</h3>
                <p>{t('reports.sectionAppearanceHint')}</p>
              </div>
            </div>
            <div className="field">
              <label>{t('reports.reportTitle')}</label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('reports.reportTitlePlaceholder')}
              />
            </div>
            <div className={`field report-filename-field ${filenameTemplateError ? 'invalid' : ''}`}>
              <label>{t('reports.filenameTemplate')}</label>
              <input
                value={filenameTemplate}
                onChange={(event) => setFilenameTemplate(event.target.value)}
                placeholder="{MM}.{YYYY}.pdf"
                spellCheck={false}
                aria-invalid={filenameTemplateError ? 'true' : 'false'}
              />
              <div className="report-filename-meta">
                <span className="hint">
                  {t('reports.filenameTokens')}{' '}
                  <code>{'{MM}'}</code> <code>{'{YYYY}'}</code>{' '}
                  <code>{'{YYYY-MM}'}</code> <code>{'{layout}'}</code>
                </span>
                {filenamePreview && (
                  <span className="report-filename-preview">
                    {t('reports.filenamePreview')} <code>{filenamePreview}</code>
                  </span>
                )}
              </div>
              {filenameErrorText && (
                <span className="report-field-error">{filenameErrorText}</span>
              )}
            </div>
            <div className="field-row">
              <div className="field">
                <label>{t('reports.timeFormat')}</label>
                <select
                  value={timeFormat}
                  onChange={(event) => setTimeFormat(event.target.value as ReportTimeFormat)}
                >
                  <option value="hours">{t('reports.timeDecimal')}</option>
                  <option value="hours-minutes">{t('reports.timeHoursMinutes')}</option>
                </select>
              </div>
              <div className="field">
                <label>{t('reports.orientation')}</label>
                <select
                  value={orientation}
                  onChange={(event) => setOrientation(event.target.value as ReportOrientation)}
                >
                  <option value="portrait">{t('reports.orientationPortrait')}</option>
                  <option value="landscape">{t('reports.orientationLandscape')}</option>
                </select>
              </div>
              <div className="field report-color-field">
                <label>{t('reports.accentColor')}</label>
                <input
                  type="color"
                  value={accentColor}
                  onChange={(event) => setAccentColor(event.target.value)}
                />
              </div>
            </div>
            <div className="report-options">
              <label>
                <input
                  type="checkbox"
                  checked={includeSummary}
                  onChange={(event) => setIncludeSummary(event.target.checked)}
                />
                {t('reports.includeSummary')}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showGeneratedAt}
                  onChange={(event) => setShowGeneratedAt(event.target.checked)}
                />
                {t('reports.showGeneratedAt')}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showPageNumbers}
                  onChange={(event) => setShowPageNumbers(event.target.checked)}
                />
                {t('reports.showPageNumbers')}
              </label>
            </div>
          </section>
        </div>

        <aside className="report-preview-column">
          <section className="card report-preview-card">
            <div className="report-preview-head">
              <div>
                <span>{t('reports.livePreview')}</span>
                <strong>{layout === 'summary' ? t('reports.layoutSummary') : t('reports.layoutDetailed')}</strong>
              </div>
              <span className="report-preview-paper">{orientation === 'portrait' ? 'A4' : 'A4 ↔'}</span>
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
                    <span>
                      {groupings.length > 0
                        ? groupings.map(groupingLabel).join(' / ')
                        : t('reports.noGrouping')}
                    </span>
                    <b>Logged</b>
                  </div>
                  {(groupings.length > 0 ? groupings : ['project' as ReportGroupKey]).map(
                    (grouping, index) => (
                      <div
                        key={`${grouping}-${index}`}
                        className={`preview-group-line depth-${Math.min(index, 3)}`}
                      >
                        <span>
                          {grouping.startsWith('custom:')
                            ? index === 0
                              ? groupingLabel(grouping).replace(
                                  `${t('reports.groupCustomField')}: `,
                                  ''
                                )
                              : 'Custom value'
                            : grouping === 'project'
                              ? 'Project Alpha (PRJ)'
                              : grouping === 'issue'
                                ? 'PRJ-123 - Example work item'
                                : grouping === 'day'
                                  ? '2026-06-15'
                                  : 'Company Jira'}
                        </span>
                        <b>{Math.max(8, 168 - index * 40)}</b>
                      </div>
                    )
                  )}
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
            <div className="report-preview-summary">
              <span>
                {groupings.length} {t('reports.groupLevels')}
              </span>
              <span>
                {layout === 'detailed' ? columns.length : 2} {t('reports.visibleColumns')}
              </span>
              <span>{orientation === 'portrait' ? 'A4 portrait' : 'A4 landscape'}</span>
            </div>
          </section>
        </aside>
      </div>

      <section className="card reports-action reports-action-pro">
        <div className="reports-output">
          <span>{t('reports.outputLabel')}</span>
          <code>
            {config.reports.outputDirectory || t('reports.defaultOutputDirectoryShort')}
            {filenamePreview ? ` / ${filenamePreview}` : ''}
          </code>
          <button className="btn btn-sm btn-ghost" onClick={changeOutputDirectory}>
            {t('reports.changeOutput')}
          </button>
        </div>
        <div className="reports-action-buttons">
          {savedDefaults && <span className="reports-default-saved">✓ {t('reports.defaultsSaved')}</span>}
          <button className="btn" onClick={saveAsDefault} disabled={Boolean(filenameTemplateError)}>
            {t('reports.saveDefaults')}
          </button>
          <button
            className="btn btn-primary reports-generate"
            onClick={generate}
            disabled={
              generating ||
              !month ||
              connectionIds.length === 0 ||
              Boolean(filenameTemplateError)
            }
          >
            {generating && <span className="spinner" />}
            {generating ? t('reports.generating') : t('reports.generate')}
          </button>
        </div>
      </section>

      {result && (
        <section className="card reports-result">
          <div className="reports-result-icon">PDF</div>
          <div className="reports-result-copy">
            <strong>{t('reports.generated')}</strong>
            <span>
              {t('reports.generatedSummary', {
                entries: result.entryCount,
                hours: formattedHours
              })}
            </span>
            <code>{result.filePath}</code>
          </div>
          <button className="btn" onClick={() => window.api.reports.reveal(result.filePath)}>
            {t('reports.showInFolder')}
          </button>
        </section>
      )}
    </div>
  )
}
