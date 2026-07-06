import { AppException } from '@shared/domain'
import type { JiraConfig, JiraIssue, JiraProject, JiraUser } from '@shared/domain'

interface JiraProjectDto {
  id: string
  key: string
  name: string
}

interface JiraIssueDto {
  id: string
  key: string
  fields: {
    summary: string
    issuetype?: { name?: string; subtask?: boolean }
  }
}

const ISSUE_FIELDS = ['summary', 'issuetype']

const toIssue = (dto: JiraIssueDto): JiraIssue => ({
  id: dto.id,
  key: dto.key,
  summary: dto.fields.summary,
  typeName: dto.fields.issuetype?.name ?? '',
  isSubtask: dto.fields.issuetype?.subtask ?? false
})

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min

/** Surface of the Jira client used by the app; implemented by mocks too. */
export interface JiraApi {
  getMyself(): Promise<JiraUser>
  getProjects(): Promise<JiraProject[]>
  searchIssues(query: string, projectKeys: string[]): Promise<JiraIssue[]>
  getProjectIssues(projectKey: string, maxResults?: number): Promise<JiraIssue[]>
  getRecentIssues(projectKeys: string[], lookbackDays: number, maxIssues: number): Promise<JiraIssue[]>
  getIssue(key: string): Promise<JiraIssue>
  getIssuesByIds(ids: string[]): Promise<JiraIssue[]>
}

/** Thin client for the Jira Cloud REST API v3 (Basic auth: email + API token). */
export class JiraClient implements JiraApi {
  constructor(private readonly getConfig: () => JiraConfig) {}

  async getMyself(): Promise<JiraUser> {
    const dto = await this.request<{ accountId: string; displayName: string }>('/rest/api/3/myself')
    return { accountId: dto.accountId, displayName: dto.displayName }
  }

  async getProjects(): Promise<JiraProject[]> {
    const projects: JiraProject[] = []
    let startAt = 0
    for (;;) {
      const page = await this.request<{ values: JiraProjectDto[]; isLast: boolean }>(
        `/rest/api/3/project/search?startAt=${startAt}&maxResults=100&orderBy=name`
      )
      projects.push(...page.values.map((p) => ({ id: p.id, key: p.key, name: p.name })))
      if (page.isLast || page.values.length === 0) break
      startAt += page.values.length
    }
    return projects
  }

  /**
   * Server-side issue search. Jira's `~` operator only matches word
   * prefixes, so every word of the query is matched independently; an
   * exact-key query is additionally resolved directly.
   */
  async searchIssues(query: string, projectKeys: string[]): Promise<JiraIssue[]> {
    const scope =
      projectKeys.length > 0
        ? `project in (${projectKeys.map((k) => JSON.stringify(k)).join(',')}) AND `
        : ''
    const trimmed = query.trim()
    const results: JiraIssue[] = []
    const seen = new Set<string>()

    const run = async (jql: string): Promise<void> => {
      try {
        const page = await this.request<{ issues: JiraIssueDto[] }>(
          '/rest/api/3/search/jql',
          'POST',
          { jql, maxResults: 30, fields: ISSUE_FIELDS }
        )
        for (const i of page.issues) {
          if (!seen.has(i.key)) {
            seen.add(i.key)
            results.push(toIssue(i))
          }
        }
      } catch {
        // A key-shaped query for a nonexistent project makes the JQL fail;
        // the remaining clauses can still produce matches.
      }
    }

    if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(trimmed)) {
      await run(`${scope}key = ${JSON.stringify(trimmed.toUpperCase())}`)
    }
    const words = trimmed.split(/\s+/).map((w) => w.replace(/["\\*]/g, '')).filter(Boolean)
    if (words.length > 0) {
      // `text ~` covers the summary AND the description (also comments).
      const textClauses = words.map((w) => `text ~ ${JSON.stringify(w + '*')}`).join(' AND ')
      await run(`${scope}${textClauses} ORDER BY updated DESC`)
    }
    return results
  }

  /**
   * Most recently updated issues of one project - the local haystack for
   * substring filtering in the issue picker.
   */
  async getProjectIssues(projectKey: string, maxResults = 200): Promise<JiraIssue[]> {
    const jql = `project = ${JSON.stringify(projectKey)} ORDER BY updated DESC`
    const page = await this.request<{ issues: JiraIssueDto[] }>(
      '/rest/api/3/search/jql',
      'POST',
      { jql, maxResults, fields: ISSUE_FIELDS }
    )
    return page.issues.map(toIssue)
  }

  /**
   * Returns recently updated issues from the given projects - the candidate
   * pool the LLM is allowed to pick from when suggesting worklogs.
   */
  async getRecentIssues(projectKeys: string[], lookbackDays: number, maxIssues: number): Promise<JiraIssue[]> {
    if (projectKeys.length === 0) return []
    const days = clamp(Math.round(lookbackDays), 1, 365)
    const jql =
      `project in (${projectKeys.map((k) => JSON.stringify(k)).join(',')})` +
      ` AND updated >= -${days}d ORDER BY updated DESC`
    const page = await this.request<{ issues: JiraIssueDto[] }>(
      '/rest/api/3/search/jql',
      'POST',
      { jql, maxResults: clamp(Math.round(maxIssues), 1, 500), fields: ISSUE_FIELDS }
    )
    return page.issues.map(toIssue)
  }

  /** Resolves an issue key to its numeric id (required by the Tempo API). */
  async getIssue(key: string): Promise<JiraIssue> {
    const dto = await this.request<JiraIssueDto>(
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS.join(',')}`
    )
    return toIssue(dto)
  }

  async getIssuesByIds(ids: string[]): Promise<JiraIssue[]> {
    if (ids.length === 0) return []
    const unique = [...new Set(ids)]
    const issues: JiraIssue[] = []
    // JQL "id in (...)" handles batches; keep them modest to stay under URL limits.
    for (let i = 0; i < unique.length; i += 100) {
      const batch = unique.slice(i, i + 100)
      const page = await this.request<{ issues: JiraIssueDto[] }>(
        '/rest/api/3/search/jql',
        'POST',
        { jql: `id in (${batch.join(',')})`, maxResults: batch.length, fields: ISSUE_FIELDS }
      )
      issues.push(...page.issues.map(toIssue))
    }
    return issues
  }

  private async request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
    const { baseUrl, email, apiToken } = this.getConfig()
    if (!baseUrl || !email || !apiToken) {
      throw new AppException('CONFIG_INVALID', 'Jira connection is not configured')
    }
    let response: Response
    try {
      response = await fetch(new URL(path, baseUrl), {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      })
    } catch (e) {
      throw new AppException('JIRA_UNREACHABLE', 'Cannot reach Jira', String(e))
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppException('JIRA_AUTH', 'Jira rejected the credentials')
    }
    if (!response.ok) {
      throw new AppException('JIRA_UNREACHABLE', `Jira returned HTTP ${response.status}`, await response.text())
    }
    return (await response.json()) as T
  }
}
