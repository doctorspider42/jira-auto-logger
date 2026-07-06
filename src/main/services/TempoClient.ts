import { AppException } from '@shared/domain'
import type { NewWorklog, TempoConfig, TempoWorkAttribute, Worklog } from '@shared/domain'
import type { JiraApi } from './JiraClient'

const TEMPO_BASE_URL = 'https://api.tempo.io/4'

interface TempoWorklogDto {
  tempoWorklogId: number
  issue: { id: number }
  timeSpentSeconds: number
  startDate: string
  description: string
  attributes?: { values?: Array<{ key: string; value: unknown }> }
}

const toAttributes = (dto: TempoWorklogDto): Array<{ key: string; value: string | boolean }> =>
  (dto.attributes?.values ?? []).map((a) => ({
    key: a.key,
    value: typeof a.value === 'boolean' ? a.value : String(a.value ?? '')
  }))

interface TempoPageDto {
  results: TempoWorklogDto[]
  metadata: { next?: string }
}

/** Surface of the Tempo client used by the app; implemented by mocks too. */
export interface TempoApi {
  testConnection(accountId: string): Promise<void>
  getWorklogs(accountId: string, fromDate: string, toDate: string): Promise<Worklog[]>
  createWorklogs(accountId: string, worklogs: NewWorklog[]): Promise<Worklog[]>
  getWorkAttributes(): Promise<TempoWorkAttribute[]>
}

/**
 * Client for the Tempo Timesheets REST API v4. Tempo identifies issues by
 * numeric Jira id, so the JiraClient is used to translate ids <-> keys.
 */
export class TempoClient implements TempoApi {
  constructor(
    private readonly getConfig: () => TempoConfig,
    private readonly jira: JiraApi
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
    for (const worklog of worklogs) {
      const issue = await this.jira.getIssue(worklog.issueKey)
      const dto = (await this.request(`${TEMPO_BASE_URL}/worklogs`, 'POST', {
        issueId: Number(issue.id),
        timeSpentSeconds: worklog.timeSpentSeconds,
        startDate: worklog.startDate,
        startTime: '09:00:00',
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

  private async request(url: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
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
    return response.json()
  }
}
