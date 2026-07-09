import { BrowserWindow, dialog, ipcMain } from 'electron'
import { AppException, err, ok } from '@shared/domain'
import type { AppConfig, NewWorklog, RegenerateDescriptionRequest, Result, SuggestionRequest } from '@shared/domain'
import { IPC_CHANNELS } from '@shared/ipc'
import { ConfigService } from './services/ConfigService'
import { ConnectionManager } from './services/ConnectionManager'
import { DEFAULT_MAIN_PROMPT } from './services/defaultPrompt'
import { GitService } from './services/GitService'
import { logger } from './services/logger'
import { LlmService } from './services/llm/LlmService'
import { isMockMode, MockGitService } from './services/mock'
import { UpdateService } from './services/UpdateService'

/**
 * Wraps a service call so every IPC handler returns a serializable Result,
 * logging duration and failures for debugging.
 */
async function toResult<T>(channel: string, fn: () => Promise<T>): Promise<Result<T>> {
  const startedAt = Date.now()
  try {
    const value = await fn()
    logger.debug('ipc', `${channel} ok in ${Date.now() - startedAt}ms`)
    return ok(value)
  } catch (e) {
    const error =
      e instanceof AppException
        ? e.toAppError()
        : { code: 'UNKNOWN' as const, message: e instanceof Error ? e.message : String(e) }
    logger.error('ipc', `${channel} failed in ${Date.now() - startedAt}ms`, {
      code: error.code,
      message: error.message,
      details: error.details,
      stack: e instanceof Error ? e.stack : undefined
    })
    return err(error)
  }
}

export function registerIpcHandlers(): UpdateService {
  const configService = new ConfigService()
  const getConfig = (): AppConfig => configService.get()
  const connections = new ConnectionManager(getConfig)
  const git = isMockMode()
    ? new MockGitService()
    : new GitService(() => getConfig().projects.flatMap((p) => p.gitFolders))
  const llm = new LlmService(getConfig, git, connections)
  const updates = new UpdateService(() => getConfig().updates.mode)

  logger.info('app', 'IPC handlers registered', {
    logFile: logger.filePath,
    ...(isMockMode() ? { mockMode: true } : {})
  })

  ipcMain.handle(IPC_CHANNELS.configGet, () => configService.get())
  ipcMain.handle(IPC_CHANNELS.configSet, (_e, config: AppConfig) =>
    toResult(IPC_CHANNELS.configSet, async () => {
      configService.set(config)
      // Re-read the update mode (may have just been enabled/changed).
      updates.onConfigChanged()
    })
  )
  ipcMain.handle(IPC_CHANNELS.configGetDefaultMainPrompt, () => DEFAULT_MAIN_PROMPT)
  ipcMain.handle(IPC_CHANNELS.configGetFilePath, () => configService.filePath)
  ipcMain.handle(IPC_CHANNELS.configGetLogFilePath, () => logger.filePath)

  ipcMain.handle(IPC_CHANNELS.dialogPickFolder, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory' as const] }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.jiraTestConnection, (_e, connectionId: string) =>
    toResult(IPC_CHANNELS.jiraTestConnection, () => connections.jira(connectionId).getMyself())
  )
  ipcMain.handle(IPC_CHANNELS.jiraGetProjects, (_e, connectionId: string) =>
    toResult(IPC_CHANNELS.jiraGetProjects, () => connections.jira(connectionId).getProjects())
  )
  ipcMain.handle(
    IPC_CHANNELS.jiraSearchIssues,
    (_e, connectionId: string, query: string, projectKeys: string[]) =>
      toResult(IPC_CHANNELS.jiraSearchIssues, () =>
        connections.jira(connectionId).searchIssues(query, projectKeys)
      )
  )
  ipcMain.handle(IPC_CHANNELS.jiraGetProjectIssues, (_e, connectionId: string, projectKey: string) =>
    toResult(IPC_CHANNELS.jiraGetProjectIssues, () =>
      connections.jira(connectionId).getProjectIssues(projectKey)
    )
  )

  ipcMain.handle(IPC_CHANNELS.tempoTestConnection, (_e, connectionId: string) =>
    toResult(IPC_CHANNELS.tempoTestConnection, async () =>
      connections.tempo(connectionId).testConnection(await connections.accountId(connectionId))
    )
  )
  ipcMain.handle(
    IPC_CHANNELS.tempoGetWorklogs,
    (_e, connectionId: string, fromDate: string, toDate: string) =>
      toResult(IPC_CHANNELS.tempoGetWorklogs, async () =>
        connections
          .tempo(connectionId)
          .getWorklogs(await connections.accountId(connectionId), fromDate, toDate)
      )
  )
  ipcMain.handle(IPC_CHANNELS.tempoCreateWorklogs, (_e, connectionId: string, worklogs: NewWorklog[]) =>
    toResult(IPC_CHANNELS.tempoCreateWorklogs, async () =>
      connections
        .tempo(connectionId)
        .createWorklogs(await connections.accountId(connectionId), worklogs)
    )
  )

  ipcMain.handle(
    IPC_CHANNELS.tempoUpdateWorklog,
    (_e, connectionId: string, tempoWorklogId: number, worklog: NewWorklog) =>
      toResult(IPC_CHANNELS.tempoUpdateWorklog, async () =>
        connections
          .tempo(connectionId)
          .updateWorklog(await connections.accountId(connectionId), tempoWorklogId, worklog)
      )
  )
  ipcMain.handle(
    IPC_CHANNELS.tempoDeleteWorklog,
    (_e, connectionId: string, tempoWorklogId: number) =>
      toResult(IPC_CHANNELS.tempoDeleteWorklog, async () =>
        connections
          .tempo(connectionId)
          .deleteWorklog(await connections.accountId(connectionId), tempoWorklogId)
      )
  )

  ipcMain.handle(IPC_CHANNELS.tempoGetWorkAttributes, (_e, connectionId: string) =>
    toResult(IPC_CHANNELS.tempoGetWorkAttributes, () =>
      connections.tempo(connectionId).getWorkAttributes()
    )
  )

  ipcMain.handle(IPC_CHANNELS.gitGetCommits, (_e, folderPaths: string[], dates: string[]) =>
    toResult(IPC_CHANNELS.gitGetCommits, () => git.getCommits(folderPaths, dates))
  )

  ipcMain.handle(IPC_CHANNELS.llmGenerateSuggestions, (_e, request: SuggestionRequest) =>
    toResult(IPC_CHANNELS.llmGenerateSuggestions, () => llm.generateSuggestions(request))
  )
  ipcMain.handle(IPC_CHANNELS.llmPreviewPrompt, (_e, request: SuggestionRequest) =>
    toResult(IPC_CHANNELS.llmPreviewPrompt, () => llm.previewPrompt(request))
  )
  ipcMain.handle(IPC_CHANNELS.llmRegenerateDescription, (_e, request: RegenerateDescriptionRequest) =>
    toResult(IPC_CHANNELS.llmRegenerateDescription, () => llm.regenerateDescription(request))
  )
  ipcMain.handle(IPC_CHANNELS.llmStartClaudeLogin, () =>
    toResult(IPC_CHANNELS.llmStartClaudeLogin, () => llm.startClaudeLogin())
  )

  ipcMain.handle(IPC_CHANNELS.updatesGetState, () => updates.getState())
  ipcMain.handle(IPC_CHANNELS.updatesCheck, () =>
    toResult(IPC_CHANNELS.updatesCheck, () => updates.check())
  )
  ipcMain.handle(IPC_CHANNELS.updatesDownload, () =>
    toResult(IPC_CHANNELS.updatesDownload, () => updates.download())
  )
  ipcMain.handle(IPC_CHANNELS.updatesQuitAndInstall, () =>
    toResult(IPC_CHANNELS.updatesQuitAndInstall, async () => updates.quitAndInstall())
  )

  return updates
}
