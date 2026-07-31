import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import { dirname, join } from 'path'
import { PROJECT_COLOR_PALETTE } from '@shared/domain'
import type { AppConfig, GitFolder, JiraConfig, JiraConnection, TempoConfig } from '@shared/domain'
import {
  DEFAULT_REPORT_FILENAME_TEMPLATE,
  validateReportFilenameTemplate
} from '@shared/reportFilename'
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

/** Legacy project shape: single connection/Jira project and a single folder. */
interface LegacyProjectFields {
  gitFolderPath?: string
  gitFolder?: GitFolder | null
  connectionId?: string
  jiraProjectKey?: string
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
      additionalInstructions: '',
      enableThinking: true
    },
    language: 'pl',
    themeId: 'dark',
    workingHoursPerDay: 8,
    workdayStart: '09:00',
    showWeekends: true,
    issuePool: { lookbackDays: 60, maxIssues: 100 },
    updates: { mode: 'ask' },
    telemetry: { enabled: true },
    reports: {
      outputDirectory: '',
      filenameTemplate: DEFAULT_REPORT_FILENAME_TEMPLATE,
      reminderOffsetDays: 0,
      defaultGrouping: 'project',
      defaultLayout: 'summary',
      defaultGroupings: ['project', 'issue'],
      defaultColumns: ['date', 'issue', 'description', 'connection'],
      defaultTimeFormat: 'hours',
      defaultOrientation: 'portrait',
      includeSummary: false,
      accentColor: '#172b4d',
      title: '',
      showGeneratedAt: true,
      showPageNumbers: true
    },
    autoLogger: {
      mode: 'off',
      runAt: '17:00',
      launchAtLogin: false,
      minimizeToTray: false
    },
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
    const config = isMockMode() ? mockConfig() : this.load()
    // Dev/test affordance: `JAL_THEME=<id>` forces a theme at launch without
    // touching config, e.g. `JAL_THEME=y2k npm run dev:mock`. Unknown ids fall
    // back to the default in `applyTheme`, so no validation is needed (and the
    // theme registry lives in the renderer, off-limits to the main process).
    // Prefer mock mode for this: mock never persists, so saving settings can't
    // write the forced theme into the real config.
    const themeOverride = process.env.JAL_THEME?.trim()
    if (themeOverride) config.themeId = themeOverride
    this.cached = config
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
      // The main prompt is now baked into the app; drop any user-edited copy
      // left over from older versions so it never resurfaces.
      delete (config.llm as { mainPrompt?: string }).mainPrompt
      config.issuePool = { ...defaultConfig().issuePool, ...stored.config.issuePool }
      config.updates = { ...defaultConfig().updates, ...stored.config.updates }
      config.telemetry = { ...defaultConfig().telemetry, ...stored.config.telemetry }
      config.reports = { ...defaultConfig().reports, ...stored.config.reports }
      config.autoLogger = { ...defaultConfig().autoLogger, ...stored.config.autoLogger }
      if (!['off', 'confirm', 'auto'].includes(config.autoLogger.mode)) {
        config.autoLogger.mode = 'off'
      }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.autoLogger.runAt)) {
        config.autoLogger.runAt = defaultConfig().autoLogger.runAt
      }
      if (validateReportFilenameTemplate(config.reports.filenameTemplate)) {
        config.reports.filenameTemplate = defaultConfig().reports.filenameTemplate
      }
      if (!Array.isArray(config.reports.defaultGroupings)) {
        const legacy = config.reports.defaultGrouping
        config.reports.defaultGroupings = legacy === 'none' ? [] : [legacy]
      }
      if (!Array.isArray(config.reports.defaultColumns)) {
        config.reports.defaultColumns = [...defaultConfig().reports.defaultColumns]
      }
      if (!['summary', 'detailed'].includes(config.reports.defaultLayout)) {
        config.reports.defaultLayout = defaultConfig().reports.defaultLayout
      }
      if (!['hours', 'hours-minutes'].includes(config.reports.defaultTimeFormat)) {
        config.reports.defaultTimeFormat = defaultConfig().reports.defaultTimeFormat
      }
      if (!['portrait', 'landscape'].includes(config.reports.defaultOrientation)) {
        config.reports.defaultOrientation = defaultConfig().reports.defaultOrientation
      }
      if (!/^#[0-9a-f]{6}$/i.test(config.reports.accentColor)) {
        config.reports.accentColor = defaultConfig().reports.accentColor
      }
      if (
        config.reports.reminderOffsetDays !== null &&
        (!Number.isInteger(config.reports.reminderOffsetDays) ||
          config.reports.reminderOffsetDays < -7 ||
          config.reports.reminderOffsetDays > 7)
      ) {
        config.reports.reminderOffsetDays = 0
      }
      config.connections = stored.config.connections ?? []
      // lastUsed changed shape over time; keep only the current fields.
      config.lastUsed = { selections: stored.config.lastUsed?.selections ?? [] }

      // Repositories used to live in a standalone registry with a global
      // author filter; both are now embedded per project. Projects also used
      // to pin a single connection/Jira project and a single folder - both
      // are now arrays (`targets`, `gitFolders`).
      const legacy = stored.config as unknown as LegacyFields
      config.projects = (stored.config.projects ?? []).map((project, index) => {
        const legacyProject = project as unknown as LegacyProjectFields
        let folders = (project.gitFolders ?? []).filter((f) => f?.path)
        if (folders.length === 0) {
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
          if (gitFolder) folders = [gitFolder]
        }
        folders = folders.map((f) => ({
          path: f.path,
          label: f.label ?? '',
          author: f.author ?? legacy.gitAuthor ?? '',
          includeAllAuthors: f.includeAllAuthors ?? false
        }))

        let targets = (project.targets ?? []).filter((t) => t?.connectionId && t.jiraProjectKey)
        if (targets.length === 0 && legacyProject.connectionId && legacyProject.jiraProjectKey) {
          targets = [
            {
              id: randomUUID(),
              connectionId: legacyProject.connectionId,
              jiraProjectKey: legacyProject.jiraProjectKey
            }
          ]
        }
        targets = targets.map((t) => ({ ...t, id: t.id ?? randomUUID() }))

        return {
          ...project,
          targets,
          gitFolders: folders,
          color: project.color ?? PROJECT_COLOR_PALETTE[index % PROJECT_COLOR_PALETTE.length],
          archived: project.archived ?? false
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
      config.projects = config.projects
        .map((p) => ({
          ...p,
          targets: p.targets.filter((t) => knownConnections.has(t.connectionId))
        }))
        .filter((p) => p.targets.length > 0)
      config.customFields = (stored.config.customFields ?? [])
        .filter((f) => knownConnections.has(f.connectionId))
        .map((f) => ({
          ...f,
          instruction: f.instruction ?? '',
          showInCalendar: f.showInCalendar ?? false,
          calendarIcon: f.calendarIcon ?? ''
        }))

      const reportBaseGroups = new Set(['project', 'issue', 'day', 'connection'])
      const reportBaseColumns = new Set([
        'date',
        'project',
        'issue',
        'description',
        'connection'
      ])
      const reportCustomIds = new Set(config.customFields.map((field) => field.id))
      const validReportKey = (key: string, base: Set<string>): boolean =>
        base.has(key) ||
        (key.startsWith('custom:') && reportCustomIds.has(key.slice('custom:'.length)))
      config.reports.defaultGroupings = [
        ...new Set(
          config.reports.defaultGroupings.filter((key) => validReportKey(key, reportBaseGroups))
        )
      ].slice(0, 5)
      config.reports.defaultColumns = [
        ...new Set(
          config.reports.defaultColumns.filter((key) => validReportKey(key, reportBaseColumns))
        )
      ]

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
