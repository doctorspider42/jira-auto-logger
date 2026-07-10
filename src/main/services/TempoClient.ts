import { AppException } from '@shared/domain'
import type { NewWorklog, TempoConfig, TempoWorkAttribute, Worklog } from '@shared/domain'
import type { JiraApi } from './JiraClient'

const TEMPO_BASE_URL = 'https://api.tempo.io/4'

interface TempoWorklogDto {
  tempoWorklogId: number
  issue: { id: number }
  timeSpentSeconds: number
  startDate: string
  /** "HH:MM:SS" position within the day; preserved when updating. */
  startTime?: string
  description: string
  attributes?: { values?: Array<{ key: string; value: unknown }> }
}

const toAttributes = (dto: TempoWorklogDto): Array<{ key: string; value: string | boolean }> =>
  (dto.attributes?.values ?? []).map((a) => ({
    key: a.key,
    value: typeof a.value === 'boolean' ? a.value : String(a.value ?? '')
  }))

/** "HH:MM" -> seconds from midnight; falls back to 09:00 when malformed. */
export function parseWorkdayStart(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return 9 * 3600
  const hours = Math.min(Number(match[1]), 23)
  const minutes = Math.min(Number(match[2]), 59)
  return hours * 3600 + minutes * 60
}

/** Seconds-from-midnight -> "HH:MM:SS", clamped to stay within the day. */
function toStartTime(seconds: number): string {
  const clamped = Math.min(seconds, 23 * 3600 + 59 * 60)
  const hh = String(Math.floor(clamped / 3600)).padStart(2, '0')
  const mm = String(Math.floor((clamped % 3600) / 60)).padStart(2, '0')
  const ss = String(clamped % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

interface TempoPageDto {
  results: TempoWorklogDto[]
  metadata: { next?: string }
}

/** Surface of the Tempo client used by the app; implemented by mocks too. */
export interface TempoApi {
  testConnection(accountId: string): Promise<void>
  getWorklogs(accountId: string, fromDate: string, toDate: string): Promise<Worklog[]>
  createWorklogs(accountId: string, worklogs: NewWorklog[]): Promise<Worklog[]>
  updateWorklog(accountId: string, tempoWorklogId: number, worklog: NewWorklog): Promise<Worklog>
  deleteWorklog(accountId: string, tempoWorklogId: number): Promise<void>
  getWorkAttributes(): Promise<TempoWorkAttribute[]>
}

/**
 * Client for the Tempo Timesheets REST API v4. Tempo identifies issues by
 * numeric Jira id, so the JiraClient is used to translate ids <-> keys.
 */
export class TempoClient implements TempoApi {
  constructor(
    private readonly getConfig: () => TempoConfig,
    private readonly jira: JiraApi,
    /** Configured start of the workday, in seconds from midnight. */
    private readonly getWorkdayStartSeconds: () => number = () => 9 * 3600
  ) {}

  /** Cheapest call that proves the token works: one worklog page of size 1. */
  async testConnection(accountId: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10)
    await this.request(
      `${TEMPO_BASE_URL}/worklogs/user/${encodeURIComponent(accountId)}?from=${today}&to=${today}&limit=1`,
      'GET'
    )
  }

  async getWorklogs(accountId: string, fromDate: string, toDate: string): Promise<Worklog[]> {
    const dtos: TempoWorklogDto[] = []
    let url: string | undefined =
      `${TEMPO_BASE_URL}/worklogs/user/${encodeURIComponent(accountId)}?from=${fromDate}&to=${toDate}&limit=200`
    while (url) {
      const page = (await this.request(url, 'GET')) as TempoPageDto
      dtos.push(...page.results)
      url = page.metadata.next
    }

    const issues = await this.jira.getIssuesByIds(dtos.map((d) => String(d.issue.id)))
    const byId = new Map(issues.map((i) => [i.id, i]))
    return dtos.map((d) => {
      const issue = byId.get(String(d.issue.id))
      return {
        tempoWorklogId: d.tempoWorklogId,
        issueId: String(d.issue.id),
        issueKey: issue?.key ?? `#${d.issue.id}`,
        issueSummary: issue?.summary ?? '',
        description: d.description ?? '',
        timeSpentSeconds: d.timeSpentSeconds,
        startDate: d.startDate,
        startTime: d.startTime,
        attributes: toAttributes(d)
      }
    })
  }

  /** Custom worklog fields defined in this Tempo instance. */
  async getWorkAttributes(): Promise<TempoWorkAttribute[]> {
    const page = (await this.request(`${TEMPO_BASE_URL}/work-attributes`, 'GET')) as {
      results: Array<{ key: string; name: string; type: string }>
    }
    return page.results.map((a) => ({ key: a.key, name: a.name, type: a.type }))
  }

  async createWorklogs(accountId: string, worklogs: NewWorklog[]): Promise<Worklog[]> {
    const created: Worklog[] = []
    // Entries of one day are laid out back-to-back instead of all starting at
    // the same hour; days with existing worklogs continue after them.
    const startOffsets = await this.initialStartOffsets(accountId, worklogs)
    for (const worklog of worklogs) {
      const offset = startOffsets.get(worklog.startDate) ?? this.getWorkdayStartSeconds()
      startOffsets.set(worklog.startDate, offset + worklog.timeSpentSeconds)

      const issue = await this.jira.getIssue(worklog.issueKey)
      const dto = (await this.request(`${TEMPO_BASE_URL}/worklogs`, 'POST', {
        issueId: Number(issue.id),
        timeSpentSeconds: worklog.timeSpentSeconds,
        startDate: worklog.startDate,
        startTime: toStartTime(offset),
        description: worklog.description,
        authorAccountId: accountId,
        ...(worklog.attributes.length > 0 ? { attributes: worklog.attributes } : {})
      })) as TempoWorklogDto
      created.push({
        tempoWorklogId: dto.tempoWorklogId,
        issueId: issue.id,
        issueKey: issue.key,
        issueSummary: issue.summary,
        description: dto.description ?? worklog.description,
        timeSpentSeconds: dto.timeSpentSeconds,
        startDate: dto.startDate,
        attributes: toAttributes(dto)
      })
    }
    return created
  }

  /** Overwrites an existing worklog, keeping its position within the day. */
  async updateWorklog(
    accountId: string,
    tempoWorklogId: number,
    worklog: NewWorklog
  ): Promise<Worklog> {
    const issue = await this.jira.getIssue(worklog.issueKey)
    // The v4 API has no partial update: PUT replaces the whole worklog, so we
    // preserve the existing start time instead of shifting the entry to 09:00.
    let startTime = toStartTime(this.getWorkdayStartSeconds())
    try {
      const existing = (await this.request(
        `${TEMPO_BASE_URL}/worklogs/${tempoWorklogId}`,
        'GET'
      )) as TempoWorklogDto
      if (existing.startTime) startTime = existing.startTime
    } catch {
      // Reading the current start time is best-effort; fall back to 09:00.
    }
    const dto = (await this.request(`${TEMPO_BASE_URL}/worklogs/${tempoWorklogId}`, 'PUT', {
      issueId: Number(issue.id),
      timeSpentSeconds: worklog.timeSpentSeconds,
      startDate: worklog.startDate,
      startTime,
      description: worklog.description,
      authorAccountId: accountId,
      // Always sent so cleared fields are dropped (PUT replaces attributes).
      attributes: worklog.attributes
    })) as TempoWorklogDto
    return {
      tempoWorklogId: dto.tempoWorklogId,
      issueId: issue.id,
      issueKey: issue.key,
      issueSummary: issue.summary,
      description: dto.description ?? worklog.description,
      timeSpentSeconds: dto.timeSpentSeconds,
      startDate: dto.startDate,
      attributes: toAttributes(dto)
    }
  }

  async deleteWorklog(_accountId: string, tempoWorklogId: number): Promise<void> {
    await this.request(`${TEMPO_BASE_URL}/worklogs/${tempoWorklogId}`, 'DELETE')
  }

  /**
   * Start-of-day offsets per date: 09:00 plus whatever is already logged
   * that day, so new entries continue after existing ones.
   */
  private async initialStartOffsets(
    accountId: string,
    worklogs: NewWorklog[]
  ): Promise<Map<string, number>> {
    const offsets = new Map<string, number>()
    if (worklogs.length === 0) return offsets
    const dates = worklogs.map((w) => w.startDate).sort()

    let loggedByDate = new Map<string, number>()
    try {
      const existing = await this.getWorklogs(accountId, dates[0], dates[dates.length - 1])
      loggedByDate = existing.reduce(
        (map, w) => map.set(w.startDate, (map.get(w.startDate) ?? 0) + w.timeSpentSeconds),
        new Map<string, number>()
      )
    } catch {
      // Reading existing worklogs is best-effort; fall back to a 09:00 start.
    }

    for (const date of new Set(dates)) {
      offsets.set(date, this.getWorkdayStartSeconds() + (loggedByDate.get(date) ?? 0))
    }
    return offsets
  }

  private async request(
    url: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    body?: unknown
  ): Promise<unknown> {
    const { apiToken } = this.getConfig()
    if (!apiToken) {
      throw new AppException('CONFIG_INVALID', 'Tempo API token is not configured')
    }
    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      })
    } catch (e) {
      throw new AppException('TEMPO_UNREACHABLE', 'Cannot reach Tempo', String(e))
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppException('TEMPO_AUTH', 'Tempo rejected the API token')
    }
    if (!response.ok) {
      throw new AppException('TEMPO_UNREACHABLE', `Tempo returned HTTP ${response.status}`, await response.text())
    }
    // DELETE (and some PUTs) answer 204 with no body; guard against JSON.parse.
    if (response.status === 204) return null
    const text = await response.text()
    return text ? JSON.parse(text) : null
  }
}
