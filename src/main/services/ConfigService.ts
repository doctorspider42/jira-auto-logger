import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import { dirname, join } from 'path'
import { PROJECT_COLOR_PALETTE } from '@shared/domain'
import type { AppConfig, GitFolder, JiraConfig, JiraConnection, TempoConfig } from '@shared/domain'
import { DEFAULT_MAIN_PROMPT } from './defaultPrompt'
import { isMockMode, mockConfig } from './mock'

interface StoredConfig {
  config: AppConfig
  /**
   * Secrets encrypted with the OS keychain (base64), kept outside the plain
   * config. Keys: `jira:<connectionId>`, `tempo:<connectionId>`, `openAiApiKey`.
   */
  secrets: Record<string, string>
}

/** Older config shapes, migrated on load. */
interface LegacyFields {
  jira?: JiraConfig
  tempo?: TempoConfig
  /** Global commit author filter, replaced by per-folder authors. */
  gitAuthor?: string
  /** Standalone git folder registry, now embedded in projects. */
  gitFolders?: GitFolder[]
}

/** Legacy project shape referencing a folder from the old registry by path. */
interface LegacyProjectFields {
  gitFolderPath?: string
  gitFolder?: GitFolder | null
}

export function defaultConfig(): AppConfig {
  return {
    connections: [],
    activeConnectionIds: [],
    projects: [],
    customFields: [],
    llm: {
      backend: 'claude-cli',
      openAi: { apiKey: '', model: 'gpt-4o-mini', baseUrl: '' },
      claudeCliPath: 'claude',
      claudeModel: '',
      copilotCliPath: 'copilot',
      copilotModel: '',
      mainPrompt: DEFAULT_MAIN_PROMPT,
      enableThinking: true
    },
    language: 'pl',
    themeId: 'dark',
    workingHoursPerDay: 8,
    workdayStart: '09:00',
    issuePool: { lookbackDays: 60, maxIssues: 100 },
    lastUsed: { selections: [] }
  }
}

/**
 * Persists the app configuration as JSON in the Electron userData directory.
 * API tokens are encrypted with `safeStorage` when the OS supports it.
 */
export class ConfigService {
  private cached: AppConfig | null = null

  get filePath(): string {
    return join(app.getPath('userData'), 'config.json')
  }

  get(): AppConfig {
    if (this.cached) return this.cached
    this.cached = isMockMode() ? mockConfig() : this.load()
    return this.cached
  }

  set(config: AppConfig): void {
    this.cached = config
    // Mock mode never touches the real config file.
    if (isMockMode()) return
    const secrets: StoredConfig['secrets'] = {}
    const plain: AppConfig = structuredClone(config)

    if (safeStorage.isEncryptionAvailable()) {
      for (const connection of plain.connections) {
        secrets[`jira:${connection.id}`] = this.encrypt(connection.jira.apiToken)
        secrets[`tempo:${connection.id}`] = this.encrypt(connection.tempo.apiToken)
        connection.jira.apiToken = ''
        connection.tempo.apiToken = ''
      }
      secrets.openAiApiKey = this.encrypt(config.llm.openAi.apiKey)
      plain.llm.openAi.apiKey = ''
    }

    const stored: StoredConfig = { config: plain, secrets }
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(stored, null, 2), 'utf8')
  }

  private load(): AppConfig {
    if (!existsSync(this.filePath)) return defaultConfig()
    try {
      const stored = JSON.parse(readFileSync(this.filePath, 'utf8')) as StoredConfig
      // Merge over defaults so new fields added in future versions get sane values.
      const config: AppConfig = { ...defaultConfig(), ...stored.config }
      config.llm = { ...defaultConfig().llm, ...stored.config.llm }
      config.issuePool = { ...defaultConfig().issuePool, ...stored.config.issuePool }
      config.connections = stored.config.connections ?? []
      // lastUsed changed shape over time; keep only the current fields.
      config.lastUsed = { selections: stored.config.lastUsed?.selections ?? [] }

      // Repositories used to live in a standalone registry with a global
      // author filter; both are now embedded per project.
      const legacy = stored.config as unknown as LegacyFields
      config.projects = (stored.config.projects ?? []).map((project, index) => {
        const legacyProject = project as unknown as LegacyProjectFields
        let gitFolder = legacyProject.gitFolder ?? null
        if (!gitFolder && legacyProject.gitFolderPath) {
          gitFolder =
            legacy.gitFolders?.find((f) => f.path === legacyProject.gitFolderPath) ?? {
              path: legacyProject.gitFolderPath,
              label: '',
              author: legacy.gitAuthor ?? '',
              includeAllAuthors: false
            }
        }
        if (gitFolder) {
          gitFolder = {
            path: gitFolder.path,
            label: gitFolder.label ?? '',
            author: gitFolder.author ?? legacy.gitAuthor ?? '',
            includeAllAuthors: gitFolder.includeAllAuthors ?? false
          }
        }
        return {
          ...project,
          gitFolder,
          color: project.color ?? PROJECT_COLOR_PALETTE[index % PROJECT_COLOR_PALETTE.length]
        }
      })

      this.migrateLegacyConnection(config, stored)

      if (safeStorage.isEncryptionAvailable()) {
        for (const connection of config.connections) {
          connection.jira.apiToken =
            this.decrypt(stored.secrets?.[`jira:${connection.id}`]) || connection.jira.apiToken
          connection.tempo.apiToken =
            this.decrypt(stored.secrets?.[`tempo:${connection.id}`]) || connection.tempo.apiToken
        }
        config.llm.openAi.apiKey =
          this.decrypt(stored.secrets?.openAiApiKey) || config.llm.openAi.apiKey
      }

      // Projects and custom fields must reference an existing connection.
      const knownConnections = new Set(config.connections.map((c) => c.id))
      config.projects = config.projects.filter((p) => knownConnections.has(p.connectionId))
      config.customFields = (stored.config.customFields ?? [])
        .filter((f) => knownConnections.has(f.connectionId))
        .map((f) => ({
          ...f,
          instruction: f.instruction ?? '',
          showInCalendar: f.showInCalendar ?? false,
          calendarIcon: f.calendarIcon ?? ''
        }))

      // Active ids must reference existing connections; default to all.
      const known = new Set(config.connections.map((c) => c.id))
      config.activeConnectionIds = (config.activeConnectionIds ?? []).filter((id) => known.has(id))
      if (config.activeConnectionIds.length === 0) {
        config.activeConnectionIds = [...known]
      }
      return config
    } catch {
      return defaultConfig()
    }
  }

  /** Wraps a single-Jira config (pre-multi-connection) into a connection. */
  private migrateLegacyConnection(config: AppConfig, stored: StoredConfig): void {
    const legacy = stored.config as unknown as LegacyFields
    if (config.connections.length > 0 || !legacy.jira?.baseUrl) return

    const connection: JiraConnection = {
      id: randomUUID(),
      name: this.hostLabel(legacy.jira.baseUrl),
      jira: { ...legacy.jira },
      tempo: { ...(legacy.tempo ?? { apiToken: '' }) }
    }
    if (safeStorage.isEncryptionAvailable()) {
      connection.jira.apiToken = this.decrypt(stored.secrets?.jiraApiToken) || connection.jira.apiToken
      connection.tempo.apiToken =
        this.decrypt(stored.secrets?.tempoApiToken) || connection.tempo.apiToken
    }
    config.connections = [connection]
    config.activeConnectionIds = [connection.id]
  }

  private hostLabel(baseUrl: string): string {
    try {
      return new URL(baseUrl).hostname.split('.')[0]
    } catch {
      return 'Jira'
    }
  }

  private encrypt(value: string): string {
    return value ? safeStorage.encryptString(value).toString('base64') : ''
  }

  private decrypt(value: string | undefined): string {
    if (!value) return ''
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch {
      return ''
    }
  }
}
