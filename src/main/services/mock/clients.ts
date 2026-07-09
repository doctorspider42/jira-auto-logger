import type {
  CommitInfo,
  JiraIssue,
  JiraProject,
  JiraUser,
  NewWorklog,
  TempoWorkAttribute,
  Worklog
} from '@shared/domain'
import type { CommitSource } from '../GitService'
import type { JiraApi } from '../JiraClient'
import type { TempoApi } from '../TempoClient'
import type { LlmProvider } from '../llm/LlmProvider'
import {
  MOCK_ISSUES,
  PROJECTS_BY_CONNECTION,
  WORK_ATTRIBUTES,
  generateWorklogs,
  mulberry32
} from './data'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** In-memory Jira backed by the static mock data of one connection. */
export class MockJiraApi implements JiraApi {
  constructor(private readonly connectionId: string) {}

  private get issues(): JiraIssue[] {
    return PROJECTS_BY_CONNECTION[this.connectionId].flatMap((p) => MOCK_ISSUES[p.key] ?? [])
  }

  async getMyself(): Promise<JiraUser> {
    return { accountId: `mock-account-${this.connectionId}`, displayName: 'Alex Developer' }
  }

  async getProjects(): Promise<JiraProject[]> {
    return PROJECTS_BY_CONNECTION[this.connectionId].map((p, i) => ({
      id: `mock-${this.connectionId}-${i}`,
      key: p.key,
      name: p.name
    }))
  }

  async searchIssues(query: string, projectKeys: string[]): Promise<JiraIssue[]> {
    const needle = query.trim().toLowerCase()
    return this.issues
      .filter((i) => projectKeys.length === 0 || projectKeys.some((k) => i.key.startsWith(`${k}-`)))
      .filter((i) => !needle || `${i.key} ${i.summary}`.toLowerCase().includes(needle))
      .slice(0, 30)
  }

  async getProjectIssues(projectKey: string): Promise<JiraIssue[]> {
    return MOCK_ISSUES[projectKey] ?? []
  }

  async getRecentIssues(projectKeys: string[]): Promise<JiraIssue[]> {
    return projectKeys.flatMap((key) => MOCK_ISSUES[key] ?? [])
  }

  async getIssue(key: string): Promise<JiraIssue> {
    const found = this.issues.find((i) => i.key === key)
    if (!found) throw new Error(`Mock issue not found: ${key}`)
    return found
  }

  async getIssuesByIds(ids: string[]): Promise<JiraIssue[]> {
    const wanted = new Set(ids)
    return this.issues.filter((i) => wanted.has(i.id))
  }
}

/** In-memory Tempo: generated history + entries created during the session. */
export class MockTempoApi implements TempoApi {
  private readonly history: Worklog[]
  private nextId = 999_000

  constructor(private readonly connectionId: string) {
    this.history = generateWorklogs(connectionId)
  }

  async testConnection(): Promise<void> {
    await sleep(300)
  }

  async getWorklogs(_accountId: string, fromDate: string, toDate: string): Promise<Worklog[]> {
    await sleep(150)
    return this.history.filter((w) => w.startDate >= fromDate && w.startDate <= toDate)
  }

  async createWorklogs(_accountId: string, worklogs: NewWorklog[]): Promise<Worklog[]> {
    await sleep(400)
    const issues = PROJECTS_BY_CONNECTION[this.connectionId].flatMap((p) => MOCK_ISSUES[p.key] ?? [])
    const created = worklogs.map((w) => {
      const issue = issues.find((i) => i.key === w.issueKey)
      return {
        tempoWorklogId: this.nextId++,
        issueId: issue?.id ?? '0',
        issueKey: w.issueKey,
        issueSummary: issue?.summary ?? '',
        description: w.description,
        timeSpentSeconds: w.timeSpentSeconds,
        startDate: w.startDate,
        attributes: w.attributes
      }
    })
    this.history.push(...created)
    return created
  }

  async updateWorklog(
    _accountId: string,
    tempoWorklogId: number,
    worklog: NewWorklog
  ): Promise<Worklog> {
    await sleep(300)
    const issues = PROJECTS_BY_CONNECTION[this.connectionId].flatMap((p) => MOCK_ISSUES[p.key] ?? [])
    const issue = issues.find((i) => i.key === worklog.issueKey)
    const index = this.history.findIndex((w) => w.tempoWorklogId === tempoWorklogId)
    const updated: Worklog = {
      tempoWorklogId,
      issueId: issue?.id ?? (index >= 0 ? this.history[index].issueId : '0'),
      issueKey: worklog.issueKey,
      issueSummary: issue?.summary ?? '',
      description: worklog.description,
      timeSpentSeconds: worklog.timeSpentSeconds,
      startDate: worklog.startDate,
      attributes: worklog.attributes
    }
    if (index >= 0) this.history[index] = updated
    else this.history.push(updated)
    return updated
  }

  async deleteWorklog(_accountId: string, tempoWorklogId: number): Promise<void> {
    await sleep(200)
    const index = this.history.findIndex((w) => w.tempoWorklogId === tempoWorklogId)
    if (index >= 0) this.history.splice(index, 1)
  }

  async getWorkAttributes(): Promise<TempoWorkAttribute[]> {
    await sleep(200)
    return WORK_ATTRIBUTES[this.connectionId] ?? []
  }
}

const COMMIT_MESSAGES: Record<string, string[]> = {
  'mobile-app': [
    'APP-101: biometric login happy path',
    'APP-101: handle lockout after failed attempts',
    'APP-102 fix camera crash on Android 15',
    'APP-104 move session storage to encrypted prefs',
    'chore: bump dependencies'
  ],
  'shop-frontend': [
    'SHOP-201 BLIK payment confirmation screen',
    'SHOP-202 fix rounding for mixed VAT carts',
    'SHOP-204 discount codes: expiry validation',
    'refactor product gallery grid'
  ],
  'shop-backend': [
    'SHOP-201 BLIK payment webhook handling',
    'SHOP-204 discount codes: persistence layer',
    'fix: race condition in order status updates',
    'chore: upgrade payment SDK'
  ]
}

/** Fake commit history keyed by folder name. */
export class MockGitService implements CommitSource {
  async getCommits(folderPaths: string[], dates: string[]): Promise<CommitInfo[]> {
    const commits: CommitInfo[] = []
    for (const path of folderPaths) {
      const label = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
      const messages = COMMIT_MESSAGES[label] ?? COMMIT_MESSAGES['mobile-app']
      const random = mulberry32(label.length * 1000)
      for (const date of dates) {
        const count = 2 + Math.floor(random() * 3)
        for (let i = 0; i < count; i++) {
          commits.push({
            hash: `${date.replaceAll('-', '')}${i}mock`,
            date: `${date}T${String(9 + i * 2).padStart(2, '0')}:15:00+01:00`,
            message: messages[Math.floor(random() * messages.length)],
            repoLabel: label
          })
        }
      }
    }
    return commits
  }
}

interface MockPromptInput {
  dates: string[]
  hoursAlreadyLogged?: Record<string, number>
  projectCount: number
  issues: Array<{ key: string; summary: string }>
  customFields?: Array<{ key: string; type: string }>
  notes: string
}

/**
 * Fake LLM: reads the input JSON embedded in the prompt and produces
 * deterministic, plausible suggestions after a short "thinking" delay. The
 * response goes through the real parsing/validation pipeline.
 */
export class MockLlmProvider implements LlmProvider {
  async complete(prompt: string): Promise<string> {
    await sleep(1500)
    if (!prompt.includes('JSON array')) {
      return 'Adjusted the implementation according to review feedback and extended the tests.'
    }

    const input = this.extractInput(prompt)
    if (!input) return '[]'
    const random = mulberry32(input.issues.length * 7 + input.dates.length)
    const perDay = input.projectCount > 1 ? [4] : [5, 3]
    const dayTarget = perDay.reduce((sum, h) => sum + h, 0)

    const entries = input.dates.flatMap((date) => {
      // Only fill the day's remaining budget, mirroring the real prompt so the
      // "already has entries" case does not double-log a full day.
      const remaining = Math.max(0, dayTarget - (input.hoursAlreadyLogged?.[date] ?? 0))
      if (remaining <= 0) return []
      const scale = remaining / dayTarget
      return perDay
        .map((hours, slot) => {
          const scaled = Math.round(hours * scale * 4) / 4
          if (scaled <= 0) return null
          const issue = input.issues[Math.floor(random() * Math.max(input.issues.length, 1))]
          const customFields = Object.fromEntries(
            (input.customFields ?? []).map((f) => [
              f.key,
              f.type === 'boolean' ? random() < 0.2 : ''
            ])
          )
          return {
            date,
            issueKey: issue?.key ?? '',
            description: issue
              ? `${slot === 0 ? 'Worked on' : 'Continued'} ${issue.summary.toLowerCase()}; addressed review remarks`
              : 'Project work',
            hours: scaled,
            ...(input.customFields?.length ? { customFields } : {})
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    })
    return JSON.stringify(entries)
  }

  private extractInput(prompt: string): MockPromptInput | null {
    // The input is a single-line compact JSON object containing "dates".
    for (const line of prompt.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('{') && trimmed.includes('"dates"')) {
        try {
          return JSON.parse(trimmed) as MockPromptInput
        } catch {
          return null
        }
      }
    }
    return null
  }
}

/** Singletons per connection so created worklogs survive within the session. */
const jiraMocks = new Map<string, MockJiraApi>()
const tempoMocks = new Map<string, MockTempoApi>()

export function mockJira(connectionId: string): MockJiraApi {
  let mock = jiraMocks.get(connectionId)
  if (!mock) {
    mock = new MockJiraApi(connectionId)
    jiraMocks.set(connectionId, mock)
  }
  return mock
}

export function mockTempo(connectionId: string): MockTempoApi {
  let mock = tempoMocks.get(connectionId)
  if (!mock) {
    mock = new MockTempoApi(connectionId)
    tempoMocks.set(connectionId, mock)
  }
  return mock
}
