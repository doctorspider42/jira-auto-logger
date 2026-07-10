/**
 * Domain model shared between the main and renderer processes.
 * Contains no Electron or DOM dependencies.
 */

// ---------- Configuration ----------

export type LlmBackendId = 'claude-cli' | 'copilot-cli' | 'openai-api'

export type ThemeId = 'dark' | 'light' | string

export interface JiraConfig {
  /** Jira Cloud base URL, e.g. https://your-org.atlassian.net */
  baseUrl: string
  /** Atlassian account e-mail. */
  email: string
  /** Jira API token. */
  apiToken: string
}

export interface TempoConfig {
  /** Tempo REST API token (separate from the Jira token). */
  apiToken: string
}

/** One Jira instance + its Tempo, e.g. the company Jira and a client's Jira. */
export interface JiraConnection {
  id: string
  /** Label shown in the UI, e.g. "Acme" or "Client X". */
  name: string
  jira: JiraConfig
  tempo: TempoConfig
}

export interface OpenAiConfig {
  apiKey: string
  model: string
  /** Custom base URL for OpenAI-compatible endpoints; empty = api.openai.com. */
  baseUrl: string
}

export interface LlmConfig {
  backend: LlmBackendId
  openAi: OpenAiConfig
  /** Executable name/path of the Claude CLI. */
  claudeCliPath: string
  /** Model passed to the Claude CLI (e.g. sonnet, opus); empty = CLI default. */
  claudeModel: string
  /** Executable name/path of the Copilot CLI. */
  copilotCliPath: string
  /** Model passed to the Copilot CLI; empty = CLI default. */
  copilotModel: string
  /**
   * Optional extra guidance the user appends to the built-in prompt (tone,
   * wording, house rules). The base prompt itself is baked into the app.
   */
  additionalInstructions: string
  /**
   * Model thinking/reasoning. Off = faster and cheaper. Applies to the
   * Claude CLI and OpenAI reasoning models; the Copilot CLI ignores it.
   */
  enableThinking: boolean
}

export interface GitFolder {
  path: string
  /** Optional label shown in the UI; defaults to the folder name. */
  label: string
  /** Commit author e-mail used to filter git history of this repo. */
  author: string
  /** When true, commits of ALL authors are included and `author` is ignored. */
  includeAllAuthors: boolean
}

/**
 * One Jira project of one connection a user project logs time to. A project
 * with several targets (e.g. the client's Jira and the company Jira) gets an
 * independent generation pass per target - each Jira has its own issues.
 */
export interface ProjectTarget {
  id: string
  connectionId: string
  /** Key of the matched Jira project, e.g. "SHOP". */
  jiraProjectKey: string
}

/**
 * A user-defined project: the unit of work selection. Pins one or more Jira
 * projects (targets), optionally git repositories and a standing instruction
 * for the LLM.
 */
export interface ProjectConfig {
  id: string
  /** Display name, e.g. "Sklep Klienta X". */
  name: string
  /** Jira projects this project logs to; entries are generated per target. */
  targets: ProjectTarget[]
  /** Repositories the project's commits come from. */
  gitFolders: GitFolder[]
  /** Optional standing instruction sent to the LLM with every generation. */
  instruction: string
  /** Hex color used to tint this project's entries in the calendar. */
  color: string
}

/** Default colors assigned to new projects, cycled by project count. */
export const PROJECT_COLOR_PALETTE = [
  '#6d9eff',
  '#4fd28a',
  '#ffc857',
  '#ff6b6b',
  '#b78bff',
  '#4dd0e1',
  '#ff9e64',
  '#f06292'
]

export type CustomFieldType = 'string' | 'boolean'

/**
 * A custom worklog field, mapped to a Tempo work attribute of one
 * connection. Values can be filled by the LLM and edited before submitting.
 */
export interface CustomFieldConfig {
  id: string
  connectionId: string
  /** Tempo work-attribute key, e.g. "_Overtime_". */
  key: string
  /** Label shown in the UI. */
  label: string
  type: CustomFieldType
  /** When true, the LLM fills the field; otherwise it starts empty/false. */
  autoFill: boolean
  /** Optional extra instruction for the LLM on how to fill this field. */
  instruction: string
  /** Mark calendar entries that carry a truthy value of this field. */
  showInCalendar: boolean
  /** Icon (emoji) used for the calendar marker. */
  calendarIcon: string
}

/** A work attribute as returned by the Tempo API. */
export interface TempoWorkAttribute {
  key: string
  name: string
  /** Tempo type, e.g. CHECKBOX, INPUT_FIELD, STATIC_LIST. */
  type: string
}

export interface AppConfig {
  connections: JiraConnection[]
  /** Connections currently toggled on in the calendar view. */
  activeConnectionIds: string[]
  projects: ProjectConfig[]
  customFields: CustomFieldConfig[]
  llm: LlmConfig
  language: 'pl' | 'en'
  themeId: ThemeId
  /** Target working hours per day used as a hint for the LLM. */
  workingHoursPerDay: number
  /** "HH:MM" start time of the first worklog of a day. */
  workdayStart: string
  /** Tuning of the existing-issue pool offered to the LLM. */
  issuePool: IssuePoolConfig
  /** Automatic-update preference. */
  updates: UpdateConfig
  lastUsed: LastUsedSelection
}

export interface IssuePoolConfig {
  /** Only issues updated within this many days are considered. */
  lookbackDays: number
  /** Upper bound on the number of issues sent to the LLM. */
  maxIssues: number
}

/**
 * How the app handles new releases.
 * - `ask`: check on start, notify, download only when the user asks (default).
 * - `auto`: download in the background and install on the next quit.
 * - `off`: never check automatically (a manual "check now" button still works).
 */
export type UpdateMode = 'ask' | 'auto' | 'off'

export interface UpdateConfig {
  mode: UpdateMode
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

/**
 * Snapshot of the updater, broadcast to the renderer on every change. On
 * platforms that cannot self-update (unsigned macOS builds) `canAutoUpdate`
 * is false and the UI offers a manual download link (`releaseUrl`) instead.
 */
export interface UpdateState {
  status: UpdateStatus
  /** Version currently running (from package.json). */
  currentVersion: string
  /** Newest available version, without the leading "v"; '' when unknown. */
  availableVersion: string
  /** Download progress percentage (0-100) while `status` is `downloading`. */
  progressPercent: number
  /** GitHub release page for the manual-download fallback; '' when unknown. */
  releaseUrl: string
  /** False on platforms/builds that cannot install updates themselves. */
  canAutoUpdate: boolean
  /** Raw error text when `status` is `error`. */
  errorMessage: string
}

/** Remembers the last dialog selection for the "use recent" shortcut. */
export interface LastUsedSelection {
  selections: ProjectSelection[]
}

// ---------- Jira / Tempo ----------

export interface JiraProject {
  id: string
  key: string
  name: string
}

export interface JiraIssue {
  id: string
  key: string
  summary: string
  /** Issue type name as configured in Jira (may be localized); '' = unknown. */
  typeName: string
  /** Reliable subtask flag from the API, independent of the localized name. */
  isSubtask: boolean
}

export interface JiraUser {
  accountId: string
  displayName: string
}

export interface Worklog {
  tempoWorklogId: number
  issueId: string
  issueKey: string
  issueSummary: string
  description: string
  timeSpentSeconds: number
  /** ISO date (yyyy-MM-dd). */
  startDate: string
  /** "HH:MM:SS" position within the day; drives the calendar day view. */
  startTime?: string
  /** Work-attribute values stored on the worklog. */
  attributes: Array<{ key: string; value: string | boolean }>
}

export interface NewWorklog {
  issueKey: string
  description: string
  timeSpentSeconds: number
  startDate: string
  /** Tempo work-attribute values attached to the worklog. */
  attributes: Array<{ key: string; value: string | boolean }>
}

// ---------- Git ----------

export interface CommitInfo {
  hash: string
  /** ISO date-time of the commit. */
  date: string
  message: string
  repoLabel: string
}

// ---------- LLM suggestions ----------

/** What the user declares about one project when generating suggestions. */
export interface ProjectSelection {
  projectId: string
  /** Per-generation note/instruction for the LLM. */
  note: string
  /** Include commits from the project's repository (when it has one). */
  useCommits: boolean
}

export interface SuggestionRequest {
  /** ISO dates (yyyy-MM-dd) selected in the calendar. */
  dates: string[]
  /** Projects the user worked on - one isolated LLM pass per project. */
  selections: ProjectSelection[]
}

/** Suggestions generated for one target (Jira project) of one configured project. */
export interface ProjectSuggestions {
  projectId: string
  projectName: string
  /** Target this group was generated for; a project has one group per target. */
  targetId: string
  connectionId: string
  connectionName: string
  jiraProjectKey: string
  suggestions: WorklogSuggestion[]
}

export interface WorklogSuggestion {
  /** Client-side identifier, not persisted anywhere. */
  id: string
  date: string
  /** Project suggested by the LLM (or derived from the issue key). */
  projectKey: string
  issueKey: string
  issueSummary: string
  /** Type of the chosen issue (for the type badge); '' = unknown. */
  issueTypeName: string
  issueIsSubtask: boolean
  description: string
  hours: number
  /** Values of configured custom fields, keyed by work-attribute key. */
  customFields: Record<string, string | boolean>
}

/** Debug preview of the exact prompt that would be sent for one project. */
export interface PromptPreview {
  label: string
  prompt: string
  /** Rough estimate (chars/4) of the input token count. */
  approxTokens: number
}

export interface RegenerateDescriptionRequest {
  suggestion: WorklogSuggestion
  /** User hint describing what to change in the description. */
  hint: string
  freeText: string
  commits: CommitInfo[]
}

// ---------- Errors ----------

export type AppErrorCode =
  | 'JIRA_AUTH'
  | 'JIRA_UNREACHABLE'
  | 'TEMPO_AUTH'
  | 'TEMPO_UNREACHABLE'
  | 'GIT_NOT_A_REPO'
  | 'GIT_FAILED'
  | 'LLM_AUTH_EXPIRED'
  | 'LLM_CLI_NOT_FOUND'
  | 'LLM_BAD_RESPONSE'
  | 'LLM_FAILED'
  | 'CONFIG_INVALID'
  | 'UNKNOWN'

/** Serializable error passed over IPC so the renderer can show a translated message. */
export interface AppError {
  code: AppErrorCode
  message: string
  details?: string
}

export class AppException extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details?: string
  ) {
    super(message)
    this.name = 'AppException'
  }

  toAppError(): AppError {
    return { code: this.code, message: this.message, details: this.details }
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })
export const err = <T>(error: AppError): Result<T> => ({ ok: false, error })
