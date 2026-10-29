import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AutoLoggerPrompt, UpdateState } from '@shared/domain'
import { AUTO_LOGGER_PROMPT_EVENT, UPDATES_STATE_EVENT } from '@shared/ipc'
import type { IpcApi } from '@shared/ipc'

export interface RuntimeInfo {
  version: string
  mock: boolean
  /** Window background effect the backend applied: mica, acrylic, blur, vibrancy or none. */
  backdrop: string
}

/**
 * Subscribes to a backend push event. `listen` is async while the IpcApi
 * contract returns the unsubscribe function synchronously, so an early
 * unsubscribe is remembered and applied once the listener exists.
 */
function subscribe<T>(event: string, callback: (payload: T) => void, onReady?: () => void): () => void {
  let unlisten: (() => void) | null = null
  let cancelled = false
  void listen<T>(event, (e) => callback(e.payload)).then((stop) => {
    if (cancelled) stop()
    else {
      unlisten = stop
      onReady?.()
    }
  })
  return () => {
    cancelled = true
    unlisten?.()
  }
}

/**
 * `window.api` backed by Tauri commands. Every method maps 1:1 onto a Rust
 * command named after its IPC channel (`jira:getProjects` -> `jira_get_projects`),
 * which returns the same `Result` envelope the Electron main process did.
 */
export function createTauriApi(): IpcApi {
  return {
    config: {
      get: () => invoke('config_get'),
      set: (config) => invoke('config_set', { config }),
      getFilePath: () => invoke('config_get_file_path'),
      getLogFilePath: () => invoke('config_get_log_file_path')
    },
    dialog: {
      pickFolder: () => invoke('dialog_pick_folder')
    },
    jira: {
      testConnection: (connectionId) => invoke('jira_test_connection', { connectionId }),
      getProjects: (connectionId) => invoke('jira_get_projects', { connectionId }),
      searchIssues: (connectionId, query, projectKeys) =>
        invoke('jira_search_issues', { connectionId, query, projectKeys }),
      getProjectIssues: (connectionId, projectKey) =>
        invoke('jira_get_project_issues', { connectionId, projectKey })
    },
    tempo: {
      testConnection: (connectionId) => invoke('tempo_test_connection', { connectionId }),
      getWorklogs: (connectionId, fromDate, toDate) =>
        invoke('tempo_get_worklogs', { connectionId, fromDate, toDate }),
      createWorklogs: (connectionId, worklogs) =>
        invoke('tempo_create_worklogs', { connectionId, worklogs }),
      updateWorklog: (connectionId, tempoWorklogId, worklog) =>
        invoke('tempo_update_worklog', { connectionId, tempoWorklogId, worklog }),
      deleteWorklog: (connectionId, tempoWorklogId) =>
        invoke('tempo_delete_worklog', { connectionId, tempoWorklogId }),
      getWorkAttributes: (connectionId) => invoke('tempo_get_work_attributes', { connectionId })
    },
    git: {
      getCommits: (folderPaths, dates) => invoke('git_get_commits', { folderPaths, dates })
    },
    llm: {
      generateSuggestions: (request) => invoke('llm_generate_suggestions', { request }),
      previewPrompt: (request) => invoke('llm_preview_prompt', { request }),
      regenerateDescription: (request) => invoke('llm_regenerate_description', { request }),
      startClaudeLogin: () => invoke('llm_start_claude_login')
    },
    reports: {
      generate: (request) => invoke('reports_generate', { request }),
      getReminder: () => invoke('reports_get_reminder'),
      reveal: (filePath) => invoke('reports_reveal', { filePath })
    },
    updates: {
      getState: () => invoke('updates_get_state'),
      check: () => invoke('updates_check'),
      getReleaseHistory: () => invoke('updates_get_release_history'),
      download: () => invoke('updates_download'),
      quitAndInstall: () => invoke('updates_quit_and_install'),
      onStateChange: (callback) => subscribe<UpdateState>(UPDATES_STATE_EVENT, callback)
    },
    autoLogger: {
      runNow: () => invoke('auto_logger_run_now'),
      // Prompts raised before the page subscribed are queued in the backend
      // and delivered once it hears the renderer is listening.
      onPrompt: (callback) =>
        subscribe<AutoLoggerPrompt>(AUTO_LOGGER_PROMPT_EVENT, callback, () => {
          void invoke('auto_logger_renderer_ready')
        })
    }
  }
}
