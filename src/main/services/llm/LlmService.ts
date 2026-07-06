import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { AppException } from '@shared/domain'
import type {
  AppConfig,
  CommitInfo,
  CustomFieldConfig,
  JiraIssue,
  ProjectConfig,
  ProjectSelection,
  ProjectSuggestions,
  PromptPreview,
  RegenerateDescriptionRequest,
  SuggestionRequest,
  Worklog,
  WorklogSuggestion
} from '@shared/domain'
import { REGENERATE_PROMPT } from '../defaultPrompt'
import type { ConnectionManager } from '../ConnectionManager'
import type { CommitSource } from '../GitService'
import { logger } from '../logger'
import { isMockMode, MockLlmProvider } from '../mock'
import type { LlmProvider } from './LlmProvider'
import { ClaudeCliProvider } from './ClaudeCliProvider'
import { CopilotCliProvider } from './CopilotCliProvider'
import { OpenAiApiProvider } from './OpenAiApiProvider'

interface RawSuggestion {
  date?: string
  issueKey?: string
  description?: string
  hours?: number
  customFields?: Record<string, unknown>
}

interface BuiltPrompt {
  prompt: string
  commits: CommitInfo[]
  candidates: JiraIssue[]
}

const LANGUAGE_NAMES: Record<string, string> = { pl: 'Polish', en: 'English' }
const ISSUE_KEY_PATTERN = /[A-Z][A-Z0-9]+-\d+/g
/** How many recent worklogs are sent to the LLM as style examples. */
const EXAMPLE_WORKLOG_COUNT = 10

/** Truncates free text going into the prompt; long tails add tokens, not signal. */
const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

/**
 * Orchestrates suggestion generation. The user declares which configured
 * projects they worked on; every project gets its own isolated LLM pass with
 * ONLY that project's issues, commits and notes in the context.
 */
export class LlmService {
  constructor(
    private readonly getConfig: () => AppConfig,
    private readonly git: CommitSource,
    private readonly connections: ConnectionManager
  ) {}

  async generateSuggestions(request: SuggestionRequest): Promise<ProjectSuggestions[]> {
    const results: ProjectSuggestions[] = []

    // Sequential on purpose: CLI backends dislike concurrent invocations.
    for (const selection of this.validSelections(request)) {
      const project = this.getProject(selection.projectId)
      const connection = this.connections.connection(project.connectionId)
      const built = await this.buildProjectPrompt(request, selection, project)
      logger.info('llm', `generate for project "${project.name}"`, {
        backend: this.getConfig().llm.backend,
        dates: request.dates.length,
        commits: built.commits.length,
        candidateIssues: built.candidates.length,
        promptLength: built.prompt.length
      })
      const text = await this.completeFor(project.name, built.prompt)
      const suggestions = this.parseSuggestions(text, request.dates, built.candidates, project)
      logger.info('llm', `"${project.name}": ${suggestions.length} suggestions parsed`)
      results.push({
        projectId: project.id,
        projectName: project.name,
        connectionId: connection.id,
        connectionName: connection.name,
        jiraProjectKey: project.jiraProjectKey,
        suggestions
      })
    }
    return results
  }

  /** Debug: the exact prompts generateSuggestions would send, per project. */
  async previewPrompt(request: SuggestionRequest): Promise<PromptPreview[]> {
    const previews: PromptPreview[] = []
    for (const selection of this.validSelections(request)) {
      const project = this.getProject(selection.projectId)
      const { prompt } = await this.buildProjectPrompt(request, selection, project)
      previews.push({
        label: project.name,
        prompt,
        // ~4 chars per token is a common rough heuristic; good enough for debugging.
        approxTokens: Math.ceil(prompt.length / 4)
      })
    }
    return previews
  }

  async regenerateDescription(request: RegenerateDescriptionRequest): Promise<string> {
    const { suggestion, hint, freeText, commits } = request
    const language = LANGUAGE_NAMES[this.getConfig().language] ?? 'English'
    const prompt = REGENERATE_PROMPT
      .replaceAll('{{language}}', language)
      .replaceAll('{{entry}}', JSON.stringify({
        issueKey: suggestion.issueKey,
        date: suggestion.date,
        description: suggestion.description,
        hours: suggestion.hours
      }))
      .replaceAll('{{commits}}', this.formatCommits(commits, suggestion.date))
      .replaceAll('{{notes}}', freeText || '(none)')
      .replaceAll('{{hint}}', hint || 'Rewrite it to be clearer.')

    const text = (await this.createProvider().complete(prompt)).trim()
    if (!text) {
      throw new AppException('LLM_BAD_RESPONSE', 'The model returned an empty description')
    }
    // Strip accidental wrapping quotes/fences.
    return text.replace(/^```[a-z]*\n?|```$/g, '').replace(/^"|"$/g, '').trim()
  }

  /** Opens a system terminal running the Claude CLI login flow. */
  async startClaudeLogin(): Promise<void> {
    const cli = this.getConfig().llm.claudeCliPath || 'claude'
    const commands: Record<string, { cmd: string; args: string[] }> = {
      win32: { cmd: 'cmd', args: ['/c', 'start', '"Claude login"', 'cmd', '/k', cli] },
      darwin: { cmd: 'open', args: ['-a', 'Terminal', cli] },
      linux: { cmd: 'x-terminal-emulator', args: ['-e', cli] }
    }
    const launcher = commands[process.platform]
    if (!launcher) {
      throw new AppException('LLM_FAILED', `Unsupported platform: ${process.platform}`)
    }
    try {
      spawn(launcher.cmd, launcher.args, { detached: true, stdio: 'ignore' }).unref()
    } catch (e) {
      throw new AppException('LLM_FAILED', 'Could not open a terminal for Claude login', String(e))
    }
  }

  private validSelections(request: SuggestionRequest): ProjectSelection[] {
    if (request.selections.length === 0) {
      throw new AppException('CONFIG_INVALID', 'No project selected')
    }
    return request.selections
  }

  private getProject(projectId: string): ProjectConfig {
    const project = this.getConfig().projects.find((p) => p.id === projectId)
    if (!project) {
      throw new AppException('CONFIG_INVALID', `Unknown project: ${projectId}`)
    }
    return project
  }

  /** Adds the project name so the user knows which pass failed. */
  private async completeFor(projectName: string, prompt: string): Promise<string> {
    try {
      return await this.createProvider().complete(prompt)
    } catch (e) {
      if (e instanceof AppException) {
        throw new AppException(e.code, `[${projectName}] ${e.message}`, e.details)
      }
      throw e
    }
  }

  private async buildProjectPrompt(
    request: SuggestionRequest,
    selection: ProjectSelection,
    project: ProjectConfig
  ): Promise<BuiltPrompt> {
    const config = this.getConfig()
    const commits =
      selection.useCommits && project.gitFolder
        ? await this.git.getCommits([project.gitFolder.path], request.dates)
        : []
    const recentWorklogs = await this.fetchRecentWorklogs(project.connectionId)
    const projectWorklogs = recentWorklogs.filter((w) =>
      w.issueKey.startsWith(`${project.jiraProjectKey}-`)
    )
    const candidates = await this.collectProjectCandidates(project, commits, projectWorklogs)
    const autoFillFields = this.fieldsFor(project).filter((f) => f.autoFill)

    // Few-shot examples: the newest entries show the user's real logging style.
    const examples = [...projectWorklogs]
      .filter((w) => w.description.trim() !== '')
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .slice(0, EXAMPLE_WORKLOG_COUNT)
      .map((w) => ({
        date: w.startDate,
        issueKey: w.issueKey,
        description: clip(w.description, 240),
        hours: Math.round((w.timeSpentSeconds / 3600) * 100) / 100
      }))

    // Compact JSON on purpose: pretty-printing burns 25-30% more input tokens.
    const input = JSON.stringify({
      dates: request.dates,
      project: {
        key: project.jiraProjectKey,
        name: project.name,
        ...(project.instruction.trim() ? { instructions: clip(project.instruction, 600) } : {})
      },
      projectCount: request.selections.length,
      ...(autoFillFields.length > 0
        ? {
            customFields: autoFillFields.map((f) => ({
              key: f.key,
              label: clip(f.label, 80),
              type: f.type,
              ...(f.instruction.trim() ? { instruction: clip(f.instruction, 300) } : {})
            }))
          }
        : {}),
      issues: candidates.map((i) => ({ key: i.key, summary: clip(i.summary, 120) })),
      recentWorklogs: examples,
      commits: commits.map((c) => ({
        // Date only - the time of day and zone offset carry no signal here.
        date: c.date.slice(0, 10),
        message: clip(c.message, 200)
      })),
      notes: selection.note
    })
    const prompt = config.llm.mainPrompt
      .replaceAll('{{workingHoursPerDay}}', String(config.workingHoursPerDay))
      .replaceAll('{{language}}', LANGUAGE_NAMES[config.language] ?? 'English')
      .replaceAll('{{input}}', input)

    return { prompt, commits, candidates }
  }

  /** Tempo worklogs from the lookback window; empty when Tempo is unavailable. */
  private async fetchRecentWorklogs(connectionId: string): Promise<Worklog[]> {
    const { lookbackDays } = this.getConfig().issuePool
    try {
      const accountId = await this.connections.accountId(connectionId)
      const to = new Date()
      const from = new Date(to.getTime() - lookbackDays * 86_400_000)
      const isoDate = (d: Date): string => d.toISOString().slice(0, 10)
      return await this.connections
        .tempo(connectionId)
        .getWorklogs(accountId, isoDate(from), isoDate(to))
    } catch {
      // Tempo unavailable or not configured - activity is a hint, not a requirement.
      return []
    }
  }

  /**
   * Builds the pool of existing issues of THIS project the model may assign
   * work to: recently updated issues, the user's recent worklog targets and
   * issues referenced in commit messages.
   */
  private async collectProjectCandidates(
    project: ProjectConfig,
    commits: CommitInfo[],
    projectWorklogs: Worklog[]
  ): Promise<JiraIssue[]> {
    const { lookbackDays, maxIssues } = this.getConfig().issuePool
    const jira = this.connections.jira(project.connectionId)
    const keyPrefix = `${project.jiraProjectKey}-`
    const candidates: JiraIssue[] = []
    const known = new Set<string>()
    const add = (issue: JiraIssue): void => {
      if (!known.has(issue.key)) {
        known.add(issue.key)
        candidates.push(issue)
      }
    }

    for (const w of projectWorklogs) {
      add({ id: w.issueId, key: w.issueKey, summary: w.issueSummary, typeName: '', isSubtask: false })
    }

    // Issues referenced explicitly in commit messages are the strongest signal.
    const referencedKeys = new Set(
      commits
        .flatMap((c) => c.message.toUpperCase().match(ISSUE_KEY_PATTERN) ?? [])
        .filter((key) => key.startsWith(keyPrefix))
    )
    for (const key of referencedKeys) {
      if (known.has(key)) continue
      try {
        add(await jira.getIssue(key))
      } catch {
        // The key does not exist in Jira - skip it.
      }
    }

    try {
      const recent = await jira.getRecentIssues([project.jiraProjectKey], lookbackDays, maxIssues)
      recent.forEach(add)
    } catch {
      // A stale project key can break the JQL - the pool is still usable without it.
    }

    return candidates.slice(0, Math.max(maxIssues, referencedKeys.size))
  }

  private createProvider(): LlmProvider {
    if (isMockMode()) return new MockLlmProvider()
    const { llm } = this.getConfig()
    switch (llm.backend) {
      case 'claude-cli':
        return new ClaudeCliProvider(llm.claudeCliPath || 'claude', llm.claudeModel, llm.enableThinking)
      case 'copilot-cli':
        // The Copilot CLI does not expose a thinking switch.
        return new CopilotCliProvider(llm.copilotCliPath || 'copilot', llm.copilotModel)
      case 'openai-api':
        return new OpenAiApiProvider(llm.openAi, llm.enableThinking)
    }
  }

  /** Custom fields of the project's connection. */
  private fieldsFor(project: ProjectConfig): CustomFieldConfig[] {
    return this.getConfig().customFields.filter((f) => f.connectionId === project.connectionId)
  }

  /**
   * Sanitizes the model's custom-field values: every configured field ends up
   * present with a value of its declared type (LLM output is never trusted).
   */
  private normalizeCustomFields(
    fields: CustomFieldConfig[],
    raw: Record<string, unknown> | undefined
  ): Record<string, string | boolean> {
    const values: Record<string, string | boolean> = {}
    for (const field of fields) {
      const value = raw?.[field.key]
      if (field.type === 'boolean') {
        values[field.key] = typeof value === 'boolean' ? value : value === 'true'
      } else {
        values[field.key] = typeof value === 'string' ? clip(value.trim(), 255) : ''
      }
    }
    return values
  }

  private parseSuggestions(
    text: string,
    allowedDates: string[],
    candidates: JiraIssue[],
    project: ProjectConfig
  ): WorklogSuggestion[] {
    const raw = this.extractJsonArray(text)
    const dates = new Set(allowedDates)
    const candidateByKey = new Map(candidates.map((i) => [i.key, i]))
    const fields = this.fieldsFor(project)
    const suggestions = raw
      .filter((s): s is RawSuggestion => typeof s === 'object' && s !== null)
      .map((s) => {
        // Ground the suggestion in reality: only existing issues survive.
        const rawIssueKey = typeof s.issueKey === 'string' ? s.issueKey.trim().toUpperCase() : ''
        const issue = candidateByKey.get(rawIssueKey)
        return {
          id: randomUUID(),
          date: typeof s.date === 'string' ? s.date : '',
          // The project is fixed by configuration - the model never picks it.
          projectKey: project.jiraProjectKey,
          issueKey: issue?.key ?? '',
          issueSummary: issue?.summary ?? '',
          issueTypeName: issue?.typeName ?? '',
          issueIsSubtask: issue?.isSubtask ?? false,
          description: typeof s.description === 'string' ? s.description.trim() : '',
          hours: this.normalizeHours(s.hours),
          customFields: this.normalizeCustomFields(fields, s.customFields)
        }
      })
      .filter((s) => dates.has(s.date) && s.description !== '')

    if (suggestions.length === 0) {
      throw new AppException('LLM_BAD_RESPONSE', 'The model returned no usable suggestions', text.slice(0, 2000))
    }
    return suggestions
  }

  private extractJsonArray(text: string): unknown[] {
    // Models occasionally wrap JSON in fences or add prose - find the array.
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start === -1 || end <= start) {
      throw new AppException('LLM_BAD_RESPONSE', 'The model response contains no JSON array', text.slice(0, 2000))
    }
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      if (!Array.isArray(parsed)) throw new Error('not an array')
      return parsed
    } catch (e) {
      throw new AppException('LLM_BAD_RESPONSE', 'The model returned malformed JSON', String(e))
    }
  }

  private normalizeHours(hours: unknown): number {
    const value = typeof hours === 'number' ? hours : Number(hours)
    if (!Number.isFinite(value) || value <= 0) return 1
    // Quarter-hour precision, capped at a sane day length.
    return Math.min(Math.round(value * 4) / 4, 24)
  }

  private formatCommits(commits: CommitInfo[], date: string): string {
    const relevant = commits.filter((c) => c.date.startsWith(date))
    const list = relevant.length > 0 ? relevant : commits
    if (list.length === 0) return '(none)'
    return list.map((c) => `- [${c.repoLabel}] ${c.date.slice(0, 10)}: ${c.message}`).join('\n')
  }
}
