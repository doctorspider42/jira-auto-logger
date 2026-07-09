import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, NewWorklog, RegenerateDescriptionRequest, SuggestionRequest } from '@shared/domain'
import { IPC_CHANNELS } from '@shared/ipc'
import type { IpcApi } from '@shared/ipc'

const api: IpcApi = {
  config: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.configGet),
    set: (config: AppConfig) => ipcRenderer.invoke(IPC_CHANNELS.configSet, config),
    getDefaultMainPrompt: () => ipcRenderer.invoke(IPC_CHANNELS.configGetDefaultMainPrompt),
    getFilePath: () => ipcRenderer.invoke(IPC_CHANNELS.configGetFilePath),
    getLogFilePath: () => ipcRenderer.invoke(IPC_CHANNELS.configGetLogFilePath)
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.dialogPickFolder)
  },
  jira: {
    testConnection: (connectionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.jiraTestConnection, connectionId),
    getProjects: (connectionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.jiraGetProjects, connectionId),
    searchIssues: (connectionId: string, query: string, projectKeys: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.jiraSearchIssues, connectionId, query, projectKeys),
    getProjectIssues: (connectionId: string, projectKey: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.jiraGetProjectIssues, connectionId, projectKey)
  },
  tempo: {
    testConnection: (connectionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.tempoTestConnection, connectionId),
    getWorklogs: (connectionId: string, fromDate: string, toDate: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.tempoGetWorklogs, connectionId, fromDate, toDate),
    createWorklogs: (connectionId: string, worklogs: NewWorklog[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.tempoCreateWorklogs, connectionId, worklogs),
    updateWorklog: (connectionId: string, tempoWorklogId: number, worklog: NewWorklog) =>
      ipcRenderer.invoke(IPC_CHANNELS.tempoUpdateWorklog, connectionId, tempoWorklogId, worklog),
    deleteWorklog: (connectionId: string, tempoWorklogId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.tempoDeleteWorklog, connectionId, tempoWorklogId),
    getWorkAttributes: (connectionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.tempoGetWorkAttributes, connectionId)
  },
  git: {
    getCommits: (folderPaths: string[], dates: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.gitGetCommits, folderPaths, dates)
  },
  llm: {
    generateSuggestions: (request: SuggestionRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.llmGenerateSuggestions, request),
    previewPrompt: (request: SuggestionRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.llmPreviewPrompt, request),
    regenerateDescription: (request: RegenerateDescriptionRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.llmRegenerateDescription, request),
    startClaudeLogin: () => ipcRenderer.invoke(IPC_CHANNELS.llmStartClaudeLogin)
  }
}

contextBridge.exposeInMainWorld('api', api)
