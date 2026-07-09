import type {
  AppConfig,
  CommitInfo,
  JiraIssue,
  JiraProject,
  JiraUser,
  NewWorklog,
  ProjectSuggestions,
  TempoWorkAttribute,
  PromptPreview,
  RegenerateDescriptionRequest,
  Result,
  SuggestionRequest,
  UpdateState,
  Worklog
} from './domain'

/**
 * Single source of truth for the IPC surface. The preload script exposes
 * exactly this interface to the renderer as `window.api`. Jira/Tempo calls
 * are scoped to one of the configured connections via `connectionId`.
 */
export interface IpcApi {
  config: {
    get(): Promise<AppConfig>
    set(config: AppConfig): Promise<Result<void>>
    getDefaultMainPrompt(): Promise<string>
    /** Absolute path of the persisted config.json (shown in settings). */
    getFilePath(): Promise<string>
    /** Absolute path of the main-process debug log (shown in settings). */
    getLogFilePath(): Promise<string>
  }
  dialog: {
    pickFolder(): Promise<string | null>
  }
  jira: {
    testConnection(connectionId: string): Promise<Result<JiraUser>>
    getProjects(connectionId: string): Promise<Result<JiraProject[]>>
    searchIssues(connectionId: string, query: string, projectKeys: string[]): Promise<Result<JiraIssue[]>>
    /** Recently updated issues of a project, for local autocomplete filtering. */
    getProjectIssues(connectionId: string, projectKey: string): Promise<Result<JiraIssue[]>>
  }
  tempo: {
    /** Verifies the Tempo token by fetching a minimal worklog page. */
    testConnection(connectionId: string): Promise<Result<void>>
    getWorklogs(connectionId: string, fromDate: string, toDate: string): Promise<Result<Worklog[]>>
    createWorklogs(connectionId: string, worklogs: NewWorklog[]): Promise<Result<Worklog[]>>
    /** Overwrites an existing worklog with new values, keeping its start time. */
    updateWorklog(
      connectionId: string,
      tempoWorklogId: number,
      worklog: NewWorklog
    ): Promise<Result<Worklog>>
    deleteWorklog(connectionId: string, tempoWorklogId: number): Promise<Result<void>>
    /** Custom worklog fields (work attributes) defined in this Tempo. */
    getWorkAttributes(connectionId: string): Promise<Result<TempoWorkAttribute[]>>
  }
  git: {
    getCommits(folderPaths: string[], dates: string[]): Promise<Result<CommitInfo[]>>
  }
  llm: {
    /** One isolated LLM pass per selected project. */
    generateSuggestions(request: SuggestionRequest): Promise<Result<ProjectSuggestions[]>>
    /** Debug: the exact prompts that would be sent, with input-token estimates. */
    previewPrompt(request: SuggestionRequest): Promise<Result<PromptPreview[]>>
    regenerateDescription(request: RegenerateDescriptionRequest): Promise<Result<string>>
    /** Attempts to start the Claude CLI login flow in a system terminal. */
    startClaudeLogin(): Promise<Result<void>>
  }
  updates: {
    /** Current updater snapshot (safe to poll on mount). */
    getState(): Promise<UpdateState>
    /** Manually trigger a check regardless of the configured mode. */
    check(): Promise<Result<void>>
    /** Start downloading the available update (auto-updatable platforms only). */
    download(): Promise<Result<void>>
    /** Quit and install a downloaded update. */
    quitAndInstall(): Promise<Result<void>>
    /**
     * Subscribe to updater state changes. Returns an unsubscribe function.
     * Unlike the request/response methods this is a push channel.
     */
    onStateChange(callback: (state: UpdateState) => void): () => void
  }
}

/** IPC channel names derived from the API shape: `domain:method`. */
export const IPC_CHANNELS = {
  configGet: 'config:get',
  configSet: 'config:set',
  configGetDefaultMainPrompt: 'config:getDefaultMainPrompt',
  configGetFilePath: 'config:getFilePath',
  configGetLogFilePath: 'config:getLogFilePath',
  dialogPickFolder: 'dialog:pickFolder',
  jiraTestConnection: 'jira:testConnection',
  jiraGetProjects: 'jira:getProjects',
  jiraSearchIssues: 'jira:searchIssues',
  jiraGetProjectIssues: 'jira:getProjectIssues',
  tempoTestConnection: 'tempo:testConnection',
  tempoGetWorklogs: 'tempo:getWorklogs',
  tempoCreateWorklogs: 'tempo:createWorklogs',
  tempoUpdateWorklog: 'tempo:updateWorklog',
  tempoDeleteWorklog: 'tempo:deleteWorklog',
  tempoGetWorkAttributes: 'tempo:getWorkAttributes',
  gitGetCommits: 'git:getCommits',
  llmGenerateSuggestions: 'llm:generateSuggestions',
  llmPreviewPrompt: 'llm:previewPrompt',
  llmRegenerateDescription: 'llm:regenerateDescription',
  llmStartClaudeLogin: 'llm:startClaudeLogin',
  updatesGetState: 'updates:getState',
  updatesCheck: 'updates:check',
  updatesDownload: 'updates:download',
  updatesQuitAndInstall: 'updates:quitAndInstall'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/** Push channel: main → renderer updater state snapshots (see IpcApi.updates.onStateChange). */
export const UPDATES_STATE_EVENT = 'updates:stateChange'
