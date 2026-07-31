import { app, Notification } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppConfig, NewWorklog, ProjectSuggestions, SuggestionRequest } from '@shared/domain'
import type { ConnectionManager } from './ConnectionManager'
import type { LlmService } from './llm/LlmService'
import { logger } from './logger'
import type { TelemetryService } from './TelemetryService'

interface AutoLoggerState {
  lastAttemptDate: string
}

const localDate = (date = new Date()): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Runs the configured weekday worklog automation while the app is alive. */
export class AutoLoggerService {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private state: AutoLoggerState = { lastAttemptDate: '' }

  constructor(
    private readonly getConfig: () => AppConfig,
    private readonly llm: LlmService,
    private readonly connections: ConnectionManager,
    private readonly telemetry: TelemetryService,
    private readonly requestConfirmation: (date: string) => void
  ) {
    this.state = this.loadState()
  }

  start(): void {
    this.stop()
    this.timer = setInterval(() => void this.check(), 30_000)
    void this.check()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  onConfigChanged(): void {
    // Re-check immediately: changing the run time to an already-passed time
    // should take effect without waiting for the next interval.
    void this.check()
  }

  private async check(now = new Date()): Promise<void> {
    const config = this.getConfig()
    if (config.autoLogger.mode === 'off' || this.running) return
    // Automated worklogs are intentionally limited to normal workdays.
    if (now.getDay() === 0 || now.getDay() === 6) return

    const date = localDate(now)
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    if (currentTime < config.autoLogger.runAt || this.state.lastAttemptDate === date) return

    this.running = true
    this.markAttempt(date)
    try {
      if (config.autoLogger.mode === 'confirm') {
        this.showConfirmation(date, config.language)
      } else {
        await this.runFullAuto(date, config)
      }
    } catch (error) {
      logger.error('auto-logger', 'scheduled run failed', {
        date,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
      this.notify(
        config.language === 'pl' ? 'Autologger: błąd' : 'Auto logger: error',
        config.language === 'pl'
          ? 'Nie udało się automatycznie zalogować czasu. Otwórz aplikację, aby sprawdzić szczegóły.'
          : 'Time could not be logged automatically. Open the app to check the details.'
      )
    } finally {
      this.running = false
    }
  }

  private showConfirmation(date: string, language: AppConfig['language']): void {
    const title = language === 'pl' ? 'Czas uzupełnić dzień' : 'Time to complete your day'
    const body =
      language === 'pl'
        ? 'Kliknij powiadomienie, aby przejrzeć i zatwierdzić wpisy z autologgera.'
        : 'Click the notification to review and approve auto-logger entries.'
    if (!Notification.isSupported()) {
      this.requestConfirmation(date)
      return
    }
    const notification = new Notification({ title, body, silent: false })
    notification.on('click', () => this.requestConfirmation(date))
    notification.show()
    logger.info('auto-logger', 'confirmation notification shown', { date })
  }

  private async runFullAuto(date: string, config: AppConfig): Promise<void> {
    const knownProjects = new Map(config.projects.map((project) => [project.id, project]))
    const selections = config.lastUsed.selections.filter((selection) => {
      const project = knownProjects.get(selection.projectId)
      return project && !project.archived
    })
    if (selections.length === 0) {
      throw new Error('No recent project selection is available for the scheduled run')
    }

    const request: SuggestionRequest = { dates: [date], selections }
    logger.info('auto-logger', 'full-auto generation started', {
      date,
      projects: selections.length
    })
    const groups = await this.llm.generateSuggestions(request)
    const created = await this.submit(groups, config)

    if (created.count > 0) {
      this.telemetry.trackWorklogsCreated(created.count, created.seconds / 3600)
    }
    const title = config.language === 'pl' ? 'Autologger zakończony' : 'Auto logger finished'
    const body =
      config.language === 'pl'
        ? created.count > 0
          ? `Zalogowano ${created.count} wpisów (${(created.seconds / 3600).toLocaleString('pl-PL')} h).`
          : 'Dzień jest już uzupełniony — nie dodano nowych wpisów.'
        : created.count > 0
          ? `Logged ${created.count} entries (${(created.seconds / 3600).toLocaleString('en-US')} h).`
          : 'The day is already complete — no new entries were added.'
    this.notify(title, body)
    logger.info('auto-logger', 'full-auto run completed', { date, ...created })
  }

  private async submit(
    groups: ProjectSuggestions[],
    config: AppConfig
  ): Promise<{ count: number; seconds: number }> {
    let count = 0
    let seconds = 0
    for (const group of groups) {
      if (group.suggestions.length === 0) continue
      const fields = config.customFields.filter((field) => field.connectionId === group.connectionId)
      const worklogs: NewWorklog[] = group.suggestions.map((suggestion) => {
        const issueKey = suggestion.issueKey.trim().toUpperCase()
        if (!issueKey) throw new Error(`Generated entry for ${group.projectName} has no issue key`)
        return {
          issueKey,
          description: suggestion.description.trim(),
          timeSpentSeconds: Math.round(suggestion.hours * 3600),
          startDate: suggestion.date,
          attributes: fields
            .map((field) => ({
              key: field.key,
              value: suggestion.customFields[field.key] ?? (field.type === 'boolean' ? false : '')
            }))
            .filter((attribute) => typeof attribute.value === 'boolean' || attribute.value !== '')
        }
      })
      const created = await this.connections
        .tempo(group.connectionId)
        .createWorklogs(await this.connections.accountId(group.connectionId), worklogs)
      count += created.length
      seconds += created.reduce((sum, worklog) => sum + worklog.timeSpentSeconds, 0)
    }
    return { count, seconds }
  }

  private notify(title: string, body: string): void {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  }

  private get statePath(): string {
    return join(app.getPath('userData'), 'auto-logger-state.json')
  }

  private loadState(): AutoLoggerState {
    try {
      if (existsSync(this.statePath)) {
        const value = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<AutoLoggerState>
        return { lastAttemptDate: value.lastAttemptDate ?? '' }
      }
    } catch (error) {
      logger.info('auto-logger', 'could not read scheduler state', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
    return { lastAttemptDate: '' }
  }

  private markAttempt(date: string): void {
    this.state = { lastAttemptDate: date }
    try {
      writeFileSync(this.statePath, JSON.stringify(this.state), 'utf8')
    } catch (error) {
      logger.info('auto-logger', 'could not persist scheduler state', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
