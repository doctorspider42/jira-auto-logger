import { invoke } from '@tauri-apps/api/core'
import type { AppConfig, Result } from '@shared/domain'
import type { IpcApi } from '@shared/ipc'
import { mockConfig } from '../main/services/mock/data'
import { MockGitService, mockJira, mockTempo } from '../main/services/mock/clients'

export interface RuntimeInfo {
  version: string
  mock: boolean
  /** Window background effect the Rust side applied: mica, acrylic, blur, vibrancy or none. */
  backdrop: string
}

/**
 * `window.api` for the Tauri trial. Config loading runs in Rust; everything
 * else is either served from the existing mock clients (mock mode) or not
 * ported yet and fails with a clear message.
 */
export function createTauriApi(runtime: RuntimeInfo): IpcApi {
  const notPorted = async <T>(): Promise<Result<T>> => ({
    ok: false,
    error: { code: 'UNKNOWN', message: 'Not ported to the Tauri trial yet.' }
  })
  // Same contract as `toResult` in the Electron main process.
  const wrap = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
    try {
      return { ok: true, value: await fn() }
    } catch (e) {
      return { ok: false, error: { code: 'UNKNOWN', message: String(e) } }
    }
  }
  const mock = runtime.mock
  const git = new MockGitService()

  return {
    config: {
      get: () => (mock ? Promise.resolve(mockConfig()) : invoke<AppConfig>('config_get')),
      set: (config) => wrap(() => invoke<void>('config_set', { config })),
      getFilePath: () => invoke<string>('config_file_path'),
      getLogFilePath: async () => ''
    },
    dialog: { pickFolder: async () => null },
    jira: {
      testConnection: (id) => (mock ? wrap(() => mockJira(id).getMyself()) : notPorted()),
      getProjects: (id) => (mock ? wrap(() => mockJira(id).getProjects()) : notPorted()),
      searchIssues: (id, query, keys) =>
        mock ? wrap(() => mockJira(id).searchIssues(query, keys)) : notPorted(),
      getProjectIssues: (id, key) => (mock ? wrap(() => mockJira(id).getProjectIssues(key)) : notPorted())
    },
    tempo: {
      testConnection: (id) => (mock ? wrap(() => mockTempo(id).testConnection()) : notPorted()),
      getWorklogs: (id, from, to) => (mock ? wrap(() => mockTempo(id).getWorklogs('', from, to)) : notPorted()),
      createWorklogs: (id, worklogs) =>
        mock ? wrap(() => mockTempo(id).createWorklogs('', worklogs)) : notPorted(),
      updateWorklog: (id, tempoId, worklog) =>
        mock ? wrap(() => mockTempo(id).updateWorklog('', tempoId, worklog)) : notPorted(),
      deleteWorklog: (id, tempoId) => (mock ? wrap(() => mockTempo(id).deleteWorklog('', tempoId)) : notPorted()),
      getWorkAttributes: (id) => (mock ? wrap(() => mockTempo(id).getWorkAttributes()) : notPorted())
    },
    git: {
      getCommits: (folders, dates) => (mock ? wrap(() => git.getCommits(folders, dates)) : notPorted())
    },
    llm: {
      generateSuggestions: notPorted,
      previewPrompt: notPorted,
      regenerateDescription: notPorted,
      startClaudeLogin: notPorted
    },
    reports: {
      generate: notPorted,
      getReminder: async () => ({ month: null, dueDate: null }),
      reveal: notPorted
    },
    updates: {
      getState: async () => ({
        status: 'idle',
        currentVersion: runtime.version,
        availableVersion: '',
        progressPercent: 0,
        releaseUrl: '',
        canAutoUpdate: false,
        errorMessage: ''
      }),
      check: notPorted,
      getReleaseHistory: notPorted,
      download: notPorted,
      quitAndInstall: notPorted,
      onStateChange: () => () => {}
    },
    autoLogger: {
      runNow: notPorted,
      onPrompt: () => () => {}
    }
  }
}
