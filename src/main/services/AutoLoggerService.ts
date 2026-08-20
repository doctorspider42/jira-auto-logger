import { app, Notification } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { AppException } from '@shared/domain'
import type {
  AppConfig,
  AutoLoggerPrompt,
  AutoLoggerRunResult,
  NewWorklog,
  ProjectSuggestions,
  SuggestionRequest
} from '@shared/domain'
import type { ConnectionManager } from './ConnectionManager'
import type { LlmService } from './llm/LlmService'
import { logger } from './logger'
import type { TelemetryService } from './TelemetryService'

interface AutoLoggerState {
  /** Date + configured time + mode of the last scheduled (never manual) attempt. */
  lastScheduledAttemptKey: string
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
  private state: AutoLoggerState = { lastScheduledAttemptKey: '' }
  /**
   * Notify-only reminder waiting for the user to open the app. Deliberately
   * in-memory: a reminder is about today, and re-opening a stale day on every
   * launch would be worse than losing it when the app quits.
   */
  private pendingPrompt: AutoLoggerPrompt | null = null

  constructor(
    private readonly getConfig: () => AppConfig,
    private readonly llm: LlmService,
    private readonly connections: ConnectionManager,
    private readonly telemetry: TelemetryService,
    private readonly requestPrompt: (prompt: AutoLoggerPrompt, focus?: boolean) => void,
    private readonly isWindowVisible: () => boolean
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
    // The interval reads live config. Keeping config changes side-effect free
    // also makes "Run now" deterministic immediately after saving settings.
    const { mode, runAt } = this.getConfig().autoLogger
    // A reminder nobody opened yet belongs to the mode that produced it.
    if (mode !== 'notify') this.pendingPrompt = null
    logger.info('auto-logger', 'configuration changed', { mode, runAt })
  }

  async runNow(): Promise<AutoLoggerRunResult> {
    const config = this.getConfig()
    if (config.autoLogger.mode === 'off') {
      throw new AppException('CONFIG_INVALID', 'Enable the auto logger before running it')
    }
    if (this.running) {
      throw new AppException('CONFIG_INVALID', 'The auto logger is already running')
    }

    const date = localDate()
    this.running = true
    logger.info('auto-logger', 'manual run started', { date, mode: config.autoLogger.mode })
    try {
      if (config.autoLogger.mode === 'confirm' || config.autoLogger.mode === 'notify') {
        // A manual run always comes from the open Settings tab, so the wizard
        // can be handed over right away even in notify-only mode.
        this.deliverPrompt({ date, autoStart: config.autoLogger.mode === 'confirm' })
        return { kind: 'review', createdCount: 0, totalSeconds: 0 }
      }
      const created = await this.runFullAuto(date, config)
      return {
        kind: 'completed',
        createdCount: created.count,
        totalSeconds: created.seconds
      }
    } finally {
      this.running = false
    }
  }

  private async check(now = new Date()): Promise<void> {
    const config = this.getConfig()
    if (config.autoLogger.mode === 'off' || this.running) return
    // Automated worklogs are intentionally limited to normal workdays.
    if (now.getDay() === 0 || now.getDay() === 6) return

    const date = localDate(now)
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const attemptKey = `${date}@${config.autoLogger.runAt}@${config.autoLogger.mode}`
    if (currentTime < config.autoLogger.runAt || this.state.lastScheduledAttemptKey === attemptKey) {
      return
    }

    this.running = true
    this.markScheduledAttempt(attemptKey)
    logger.info('auto-logger', 'scheduled run started', {
      date,
      runAt: config.autoLogger.runAt,
      mode: config.autoLogger.mode
    })
    try {
      if (config.autoLogger.mode === 'confirm') {
        this.showConfirmation(date, config.language)
      } else if (config.autoLogger.mode === 'notify') {
        this.showReminder(date, config.language)
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
        ? 'Autologger otwiera propozycje do przejrzenia i zatwierdzenia.'
        : 'The auto logger is opening suggestions for review and approval.'
    if (Notification.isSupported()) {
      new Notification({ title, body, silent: false }).show()
    }
    // Do not rely on an OS toast: Windows can suppress notifications even
    // though Electron reports them as supported. Opening the review wizard is
    // the reliable confirmation surface and mirrors the manual action.
    this.deliverPrompt({ date, autoStart: true })
    logger.info('auto-logger', 'confirmation notification and review requested', { date })
  }

  /**
   * Notify-only mode: nothing is generated and nothing is logged. The reminder
   * only points at the day; opening the app opens the wizard for it exactly as
   * a click on that day in the calendar would.
   */
  private showReminder(date: string, language: AppConfig['language']): void {
    const prompt: AutoLoggerPrompt = { date, autoStart: false }
    const title = language === 'pl' ? 'Czas uzupełnić dzień' : 'Time to complete your day'
    const body =
      language === 'pl'
        ? 'Otwórz aplikację, aby zalogować ten dzień. Nic nie zostało jeszcze dodane.'
        : 'Open the app to log this day. Nothing has been added yet.'
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body, silent: false })
      notification.on('click', () => this.deliverPrompt(prompt))
      notification.show()
    }
    // Unlike confirmation mode this must not steal focus: an open window just
    // gets the wizard, a window hidden in the tray keeps the reminder pending
    // until the user opens the app themselves.
    if (this.isWindowVisible()) this.deliverPrompt(prompt, false)
    else this.pendingPrompt = prompt
    logger.info('auto-logger', 'reminder shown', { date, pending: this.pendingPrompt !== null })
  }

  /**
   * Hands a reminder the user has not opened yet to the freshly shown window.
   * Called while that window is being shown, so it needs no focus of its own.
   */
  flushPendingPrompt(): void {
    const prompt = this.pendingPrompt
    if (!prompt) return
    logger.info('auto-logger', 'delivering pending reminder', { date: prompt.date })
    this.deliverPrompt(prompt, false)
  }

  /** Opens the wizard for a day; clears the pending reminder so it fires once. */
  private deliverPrompt(prompt: AutoLoggerPrompt, focus = true): void {
    this.pendingPrompt = null
    this.requestPrompt(prompt, focus)
  }

  private async runFullAuto(
    date: string,
    config: AppConfig
  ): Promise<{ count: number; seconds: number }> {
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
    return created
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
        return { lastScheduledAttemptKey: value.lastScheduledAttemptKey ?? '' }
      }
    } catch (error) {
      logger.info('auto-logger', 'could not read scheduler state', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
    return { lastScheduledAttemptKey: '' }
  }

  private markScheduledAttempt(attemptKey: string): void {
    this.state = { lastScheduledAttemptKey: attemptKey }
    try {
      writeFileSync(this.statePath, JSON.stringify(this.state), 'utf8')
    } catch (error) {
      logger.info('auto-logger', 'could not persist scheduler state', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
