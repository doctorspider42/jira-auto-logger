import { app, BrowserWindow } from 'electron'
import { existsSync, readdirSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join, parse } from 'path'
import { AppException } from '@shared/domain'
import {
  formatReportFilename,
  validateReportFilenameTemplate
} from '@shared/reportFilename'
import type {
  AppConfig,
  CustomFieldConfig,
  JiraConnection,
  ProjectConfig,
  ProjectTarget,
  ReportColumnKey,
  ReportGroupKey,
  ReportReminder,
  ReportRequest,
  ReportResult,
  Worklog
} from '@shared/domain'
import type { ConnectionManager } from './ConnectionManager'

interface ReportEntry extends Worklog {
  connection: JiraConnection
  projectId: string
  jiraProjectName: string
  jiraProjectKey: string
}

interface GroupNode {
  label: string
  entries: ReportEntry[]
  seconds: number
  children: GroupNode[]
}

interface MonthRange {
  fromDate: string
  toDate: string
  year: number
  monthIndex: number
}

const BASE_GROUPINGS = new Set<ReportGroupKey>(['project', 'issue', 'day', 'connection'])
const BASE_COLUMNS = new Set<ReportColumnKey>([
  'date',
  'project',
  'issue',
  'description',
  'connection'
])

function isoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseMonth(month: string): MonthRange {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) throw new AppException('CONFIG_INVALID', 'Report month must use yyyy-MM.')
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (monthIndex < 0 || monthIndex > 11) {
    throw new AppException('CONFIG_INVALID', 'Report month is outside the valid range.')
  }
  return {
    year,
    monthIndex,
    fromDate: `${month}-01`,
    toDate: isoDate(new Date(year, monthIndex + 1, 0))
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('—', '-')
    .replaceAll('–', '-')
    .replaceAll('‑', '-')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function secondsOf(entries: ReportEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.timeSpentSeconds, 0)
}

function formatTime(seconds: number, format: ReportRequest['timeFormat']): string {
  if (format === 'hours-minutes') {
    const totalMinutes = Math.round(seconds / 60)
    return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')}`
  }
  const hours = seconds / 3600
  return Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(2).replace(/0$/, '')
}

function tempoDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${String(day).padStart(2, '0')}/${months[month - 1]}/${String(year).slice(-2)}`
}

/** Native Chromium PDF generation keeps packaged builds dependency-free. */
export class ReportService {
  constructor(
    private readonly getConfig: () => AppConfig,
    private readonly connections: ConnectionManager
  ) {}

  async generate(request: ReportRequest): Promise<ReportResult> {
    const range = parseMonth(request.month)
    const config = this.getConfig()
    this.validateRequest(request, config)

    const connectionIds =
      request.connectionIds.length > 0
        ? request.connectionIds
        : config.activeConnectionIds.length > 0
          ? config.activeConnectionIds
          : config.connections.map((connection) => connection.id)
    const selected = [...new Set(connectionIds)].map((id) => this.connections.connection(id))
    if (selected.length === 0) {
      throw new AppException('CONFIG_INVALID', 'Configure at least one Jira and Tempo connection.')
    }

    const batches = await Promise.all(
      selected.map(async (connection) => {
        const accountId = await this.connections.accountId(connection.id)
        const [worklogs, jiraProjects] = await Promise.all([
          this.connections
            .tempo(connection.id)
            .getWorklogs(accountId, range.fromDate, range.toDate),
          this.connections.jira(connection.id).getProjects()
        ])
        const jiraProjectNames = new Map(
          jiraProjects.map((project) => [project.key, project.name])
        )
        return worklogs.map((worklog): ReportEntry => {
          const match = this.projectMatch(config, connection.id, worklog.issueKey)
          const jiraProjectKey = worklog.issueKey.split('-')[0]
          return {
            ...worklog,
            connection,
            projectId: match?.project.id ?? '',
            jiraProjectName: jiraProjectNames.get(jiraProjectKey) ?? '',
            jiraProjectKey
          }
        })
      })
    )
    const selectedProjects = new Set(request.projectIds)
    const entries = batches
      .flat()
      .filter((entry) => selectedProjects.size === 0 || selectedProjects.has(entry.projectId))
      .sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
          a.issueKey.localeCompare(b.issueKey)
      )

    const outputDirectory =
      config.reports.outputDirectory.trim() ||
      join(app.getPath('documents'), 'Jira Auto Logger Reports')
    await mkdir(outputDirectory, { recursive: true })
    const baseFileName = formatReportFilename(
      request.filenameTemplate,
      request.month,
      request.layout
    )
    const filePath = this.availableFilePath(outputDirectory, baseFileName)
    const html = this.renderHtml(entries, request, range, config)
    const generatedAt = new Date()
    const footerDate = `${isoDate(generatedAt)} ${String(generatedAt.getHours()).padStart(2, '0')}:${String(generatedAt.getMinutes()).padStart(2, '0')}`
    const footerLeft = request.showGeneratedAt ? footerDate : ''
    const footerRight = request.showPageNumbers
      ? '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>'
      : ''
    const window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })

    try {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const pdf = await window.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        landscape: request.orientation === 'landscape',
        preferCSSPageSize: true,
        displayHeaderFooter: request.showGeneratedAt || request.showPageNumbers,
        headerTemplate: '<div></div>',
        footerTemplate: `<div style="box-sizing:border-box;width:100%;padding:0 14mm;color:#333;font:8px Arial,sans-serif;display:flex;justify-content:space-between;">
          <span>${escapeHtml(footerLeft)}</span>${footerRight}
        </div>`
      })
      await writeFile(filePath, pdf)
    } finally {
      window.destroy()
    }

    return { filePath, entryCount: entries.length, totalSeconds: secondsOf(entries) }
  }

  getReminder(now = new Date()): ReportReminder {
    const config = this.getConfig()
    const offset = config.reports.reminderOffsetDays
    if (offset === null) return { month: null, dueDate: null }

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const candidates = [
      new Date(today.getFullYear(), today.getMonth() - 1, 1),
      new Date(today.getFullYear(), today.getMonth(), 1)
    ]
    for (const candidate of candidates) {
      const end = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0)
      const due = new Date(end)
      due.setDate(due.getDate() + offset)
      const expires = new Date(end)
      expires.setDate(expires.getDate() + 7)
      const month = `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, '0')}`
      if (today >= due && today <= expires && !this.hasReport(month)) {
        return { month, dueDate: isoDate(due) }
      }
    }
    return { month: null, dueDate: null }
  }

  private validateRequest(request: ReportRequest, config: AppConfig): void {
    if (!['summary', 'detailed'].includes(request.layout)) {
      throw new AppException('CONFIG_INVALID', 'Unknown report layout.')
    }
    const filenameError = validateReportFilenameTemplate(request.filenameTemplate)
    if (filenameError) {
      throw new AppException(
        'CONFIG_INVALID',
        `Report filename template is invalid (${filenameError}).`
      )
    }
    if (request.groupings.length > 5 || new Set(request.groupings).size !== request.groupings.length) {
      throw new AppException('CONFIG_INVALID', 'Report grouping hierarchy is invalid.')
    }
    const customIds = new Set(config.customFields.map((field) => field.id))
    const validDynamic = (key: string): boolean =>
      key.startsWith('custom:') && customIds.has(key.slice('custom:'.length))
    if (request.groupings.some((key) => !BASE_GROUPINGS.has(key) && !validDynamic(key))) {
      throw new AppException('CONFIG_INVALID', 'Report contains an unknown grouping.')
    }
    if (request.columns.some((key) => !BASE_COLUMNS.has(key) && !validDynamic(key))) {
      throw new AppException('CONFIG_INVALID', 'Report contains an unknown column.')
    }
    if (!['hours', 'hours-minutes'].includes(request.timeFormat)) {
      throw new AppException('CONFIG_INVALID', 'Unknown report time format.')
    }
    if (!['portrait', 'landscape'].includes(request.orientation)) {
      throw new AppException('CONFIG_INVALID', 'Unknown report orientation.')
    }
  }

  private hasReport(month: string): boolean {
    const config = this.getConfig()
    const directory =
      config.reports.outputDirectory.trim() ||
      join(app.getPath('documents'), 'Jira Auto Logger Reports')
    if (!existsSync(directory)) return false
    try {
      const expectedNames = (['summary', 'detailed'] as const).map((layout) =>
        formatReportFilename(config.reports.filenameTemplate, month, layout)
      )
      return readdirSync(directory).some((file) =>
        expectedNames.some((expected) => {
          if (file === expected) return true
          const { name, ext } = parse(expected)
          return file.startsWith(`${name} (`) && file.endsWith(`)${ext}`)
        })
      )
    } catch {
      return false
    }
  }

  private availableFilePath(directory: string, fileName: string): string {
    const preferred = join(directory, fileName)
    if (!existsSync(preferred)) return preferred
    const { name, ext } = parse(fileName)
    for (let copy = 2; copy < 10_000; copy++) {
      const candidate = join(directory, `${name} (${copy})${ext}`)
      if (!existsSync(candidate)) return candidate
    }
    throw new AppException('UNKNOWN', 'Could not choose a unique report filename.')
  }

  private projectMatch(
    config: AppConfig,
    connectionId: string,
    issueKey: string
  ): { project: ProjectConfig; target: ProjectTarget } | null {
    for (const project of config.projects) {
      const target = project.targets.find(
        (candidate) =>
          candidate.connectionId === connectionId &&
          issueKey.startsWith(`${candidate.jiraProjectKey}-`)
      )
      if (target) return { project, target }
    }
    return null
  }

  private customField(config: AppConfig, key: ReportGroupKey | ReportColumnKey): CustomFieldConfig | null {
    if (!key.startsWith('custom:')) return null
    return config.customFields.find((field) => field.id === key.slice('custom:'.length)) ?? null
  }

  private attributeValue(entry: ReportEntry, field: CustomFieldConfig): string | boolean | undefined {
    if (entry.connection.id !== field.connectionId) return undefined
    return entry.attributes.find((attribute) => attribute.key === field.key)?.value
  }

  private groupingLabel(
    entry: ReportEntry,
    key: ReportGroupKey,
    config: AppConfig,
    language: AppConfig['language']
  ): string {
    if (key === 'project') {
      return entry.jiraProjectName
        ? `${entry.jiraProjectName} (${entry.jiraProjectKey})`
        : entry.jiraProjectKey
    }
    if (key === 'issue') return `${entry.issueKey} - ${entry.issueSummary}`
    if (key === 'day') return entry.startDate
    if (key === 'connection') return entry.connection.name || entry.connection.jira.baseUrl
    const field = this.customField(config, key)
    if (!field) return ''
    if (entry.connection.id !== field.connectionId) {
      return language === 'pl' ? `Nie dotyczy: ${field.label}` : `Not applicable: ${field.label}`
    }
    const value = this.attributeValue(entry, field)
    if (field.type === 'boolean') {
      return value === true || value === 'true' ? field.label : `Not ${field.label}`
    }
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : language === 'pl'
        ? `Brak: ${field.label}`
        : `No ${field.label}`
  }

  private groupingName(
    key: ReportGroupKey,
    config: AppConfig
  ): string {
    if (key === 'project') return 'Space'
    if (key === 'issue') return 'Work Item'
    if (key === 'day') return 'Date'
    if (key === 'connection') return 'Connection'
    return this.customField(config, key)?.label ?? 'Custom field'
  }

  private groupTree(
    entries: ReportEntry[],
    groupings: ReportGroupKey[],
    config: AppConfig,
    language: AppConfig['language'],
    depth = 0
  ): GroupNode[] {
    const key = groupings[depth]
    if (!key) return []
    const buckets = new Map<string, ReportEntry[]>()
    for (const entry of entries) {
      const label = this.groupingLabel(entry, key, config, language)
      buckets.set(label, [...(buckets.get(label) ?? []), entry])
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b, language))
      .map(([label, groupedEntries]) => ({
        label,
        entries: groupedEntries,
        seconds: secondsOf(groupedEntries),
        children: this.groupTree(groupedEntries, groupings, config, language, depth + 1)
      }))
  }

  private renderSummaryRows(
    nodes: GroupNode[],
    depth: number,
    request: ReportRequest
  ): string {
    return nodes
      .map((node) => {
        const row = `<tr class="summary-row level-${Math.min(depth, 4)}">
          <td style="padding-left:${depth * 10}px">${escapeHtml(node.label)}</td>
          <td>${formatTime(node.seconds, request.timeFormat)}</td>
        </tr>`
        return `${row}${this.renderSummaryRows(node.children, depth + 1, request)}`
      })
      .join('')
  }

  private columnName(key: ReportColumnKey, config: AppConfig, polish: boolean): string {
    if (key === 'date') return polish ? 'Data' : 'Date'
    if (key === 'project') return 'Space'
    if (key === 'issue') return 'Work Item'
    if (key === 'description') return polish ? 'Opis pracy' : 'Description'
    if (key === 'connection') return 'Connection'
    return this.customField(config, key)?.label ?? 'Custom field'
  }

  private columnValue(
    entry: ReportEntry,
    key: ReportColumnKey,
    config: AppConfig,
    polish: boolean
  ): string {
    if (key === 'date') return entry.startDate
    if (key === 'project') {
      return entry.jiraProjectName
        ? `${entry.jiraProjectName} (${entry.jiraProjectKey})`
        : entry.jiraProjectKey
    }
    if (key === 'issue') return `${entry.issueKey} - ${entry.issueSummary}`
    if (key === 'description') return entry.description || '-'
    if (key === 'connection') return entry.connection.name || entry.connection.jira.baseUrl
    const field = this.customField(config, key)
    if (!field) return '-'
    const value = this.attributeValue(entry, field)
    if (field.type === 'boolean') {
      return value === true || value === 'true' ? (polish ? 'Tak' : 'Yes') : (polish ? 'Nie' : 'No')
    }
    return typeof value === 'string' && value.trim() ? value.trim() : '-'
  }

  private renderDetailEntries(
    entries: ReportEntry[],
    request: ReportRequest,
    config: AppConfig,
    polish: boolean
  ): string {
    return entries
      .map(
        (entry) => `<tr class="detail-entry">
          ${request.columns
            .map(
              (column) =>
                `<td class="${column === 'date' ? 'nowrap' : ''}">${escapeHtml(this.columnValue(entry, column, config, polish))}</td>`
            )
            .join('')}
          <td class="logged">${formatTime(entry.timeSpentSeconds, request.timeFormat)}</td>
        </tr>`
      )
      .join('')
  }

  private renderDetailedNodes(
    nodes: GroupNode[],
    depth: number,
    request: ReportRequest,
    config: AppConfig,
    polish: boolean
  ): string {
    return nodes
      .map((node) => {
        const heading = `<tr class="detail-group level-${Math.min(depth, 4)}">
          <td colspan="${request.columns.length}"><span style="margin-left:${depth * 10}px">${escapeHtml(node.label)}</span></td>
          <td class="logged">${formatTime(node.seconds, request.timeFormat)}</td>
        </tr>`
        const content =
          node.children.length > 0
            ? this.renderDetailedNodes(node.children, depth + 1, request, config, polish)
            : this.renderDetailEntries(node.entries, request, config, polish)
        return `${heading}${content}`
      })
      .join('')
  }

  private renderHtml(
    entries: ReportEntry[],
    request: ReportRequest,
    range: MonthRange,
    config: AppConfig
  ): string {
    const polish = config.language === 'pl'
    const labels = polish
      ? {
          period: 'Okres',
          total: 'Łącznie zalogowano',
          logged: 'Zalogowano',
          entries: 'Wpisy',
          days: 'Dni z wpisami',
          connections: 'Połączenia',
          noEntries: 'Brak wpisów czasu w wybranym okresie.'
        }
      : {
          period: 'Period',
          total: 'Total Logged',
          logged: 'Logged',
          entries: 'Entries',
          days: 'Days with entries',
          connections: 'Connections',
          noEntries: 'No time entries in the selected period.'
        }
    const total = secondsOf(entries)
    const accent = /^#[0-9a-f]{6}$/i.test(request.accentColor) ? request.accentColor : '#172b4d'
    const tree = this.groupTree(entries, request.groupings, config, config.language)
    const summaryHeading =
      request.groupings.length > 0
        ? request.groupings.map((key) => this.groupingName(key, config)).join(' / ')
        : polish
          ? 'Wszystkie wpisy'
          : 'All entries'
    const summaryRows =
      entries.length === 0
        ? `<tr><td class="empty" colspan="2">${labels.noEntries}</td></tr>`
        : request.groupings.length > 0
          ? this.renderSummaryRows(tree, 0, request)
          : `<tr class="summary-row level-0"><td>${summaryHeading}</td><td>${formatTime(total, request.timeFormat)}</td></tr>`
    const columns: ReportColumnKey[] =
      request.columns.length > 0 ? request.columns : ['issue', 'description']
    const detailedRequest: ReportRequest = { ...request, columns }
    const detailRows =
      entries.length === 0
        ? `<tr><td class="empty" colspan="${columns.length + 1}">${labels.noEntries}</td></tr>`
        : request.groupings.length > 0
          ? this.renderDetailedNodes(tree, 0, detailedRequest, config, polish)
          : this.renderDetailEntries(entries, detailedRequest, config, polish)
    const title = request.title.trim()
    const paper = request.orientation === 'landscape' ? 'A4 landscape' : 'A4 portrait'

    return `<!doctype html>
<html lang="${config.language}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title || `Tempo report ${request.month}`)}</title>
<style>
  @page { size: ${paper}; margin: 14mm 14mm 18mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: #111; background: #fff; font: 9px/1.4 Arial, "Noto Sans", sans-serif; }
  .report-head { display: flex; justify-content: space-between; align-items: flex-end; min-height: 46px; }
  .report-title { margin: 0; max-width: 55%; font-size: 19px; line-height: 1.15; color: var(--accent); }
  .report-meta { margin-left: auto; text-align: right; font-size: 12px; }
  .report-meta strong { font-size: 10px; }
  .top-rule { margin: 5px 0 0; border-top: 2px solid var(--accent); }
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0; }
  .metric { border: 1px solid #ddd; border-radius: 5px; padding: 7px 9px; }
  .metric span { display: block; color: #666; font-size: 7px; text-transform: uppercase; letter-spacing: .4px; }
  .metric strong { display: block; margin-top: 2px; color: var(--accent); font-size: 14px; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  thead { display: table-header-group; }
  th { padding: 5px 0; border-bottom: 1px solid #111; text-align: left; font-weight: 400; }
  th:last-child { width: 64px; text-align: right; }
  tr { break-inside: avoid; }
  td { vertical-align: top; overflow-wrap: anywhere; }
  .logged { width: 64px; text-align: right; white-space: nowrap; }
  .summary-row td { padding-top: 6px; padding-bottom: 2px; font-size: 9px; }
  .summary-row.level-0 td { padding-top: 8px; padding-bottom: 5px; border-bottom: 1px solid #aaa; font-weight: 700; }
  .summary-row.level-1 td { padding-top: 5px; font-size: 9px; }
  .summary-row.level-2 td, .summary-row.level-3 td, .summary-row.level-4 td { font-size: 8.7px; }
  .detail-entry td { padding: 5px 6px 5px 0; border-bottom: 1px solid #e5e5e5; }
  .detail-entry td:last-child { padding-right: 0; }
  .detail-group td { padding: 7px 0 4px; color: var(--accent); font-weight: 700; border-bottom: 1px solid color-mix(in srgb, var(--accent) 32%, #ddd); }
  .detail-group.level-1 td, .detail-group.level-2 td { padding-top: 5px; font-weight: 600; }
  .nowrap { white-space: nowrap; }
  .empty { padding: 24px; text-align: center; color: #666; }
</style>
</head>
<body style="--accent:${accent}">
  <header class="report-head">
    ${title ? `<h1 class="report-title">${escapeHtml(title)}</h1>` : '<span></span>'}
    <div class="report-meta">
      ${labels.period}: ${tempoDate(range.fromDate)} - ${tempoDate(range.toDate)}<br>
      <span>${labels.total}: <strong>${formatTime(total, request.timeFormat)}</strong></span>
    </div>
  </header>
  <div class="top-rule"></div>
  ${
    request.includeSummary
      ? `<section class="metrics">
          <div class="metric"><span>${labels.total}</span><strong>${formatTime(total, request.timeFormat)}</strong></div>
          <div class="metric"><span>${labels.entries}</span><strong>${entries.length}</strong></div>
          <div class="metric"><span>${labels.days}</span><strong>${new Set(entries.map((entry) => entry.startDate)).size}</strong></div>
          <div class="metric"><span>${labels.connections}</span><strong>${new Set(entries.map((entry) => entry.connection.id)).size}</strong></div>
        </section>`
      : ''
  }
  ${
    request.layout === 'summary'
      ? `<table>
          <thead><tr><th>${escapeHtml(summaryHeading)}</th><th>${labels.logged}</th></tr></thead>
          <tbody>${summaryRows}</tbody>
        </table>`
      : `<table class="detail-table">
          <thead><tr>${columns.map((column) => `<th>${escapeHtml(this.columnName(column, config, polish))}</th>`).join('')}<th>${labels.logged}</th></tr></thead>
          <tbody>${detailRows}</tbody>
        </table>`
  }
</body>
</html>`
  }
}
