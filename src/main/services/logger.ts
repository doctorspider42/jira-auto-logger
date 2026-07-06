import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

type Level = 'DEBUG' | 'INFO' | 'ERROR'

const DETAILS_LIMIT = 4000

/**
 * Minimal file logger for debugging. Writes to userData/logs/main.log and
 * mirrors to the console in dev mode. Never log secrets or full prompts -
 * lengths and identifiers are enough to trace a problem.
 */
class Logger {
  private directoryEnsured = false

  get filePath(): string {
    return join(app.getPath('userData'), 'logs', 'main.log')
  }

  debug(scope: string, message: string, details?: unknown): void {
    this.write('DEBUG', scope, message, details)
  }

  info(scope: string, message: string, details?: unknown): void {
    this.write('INFO', scope, message, details)
  }

  error(scope: string, message: string, details?: unknown): void {
    this.write('ERROR', scope, message, details)
  }

  private write(level: Level, scope: string, message: string, details?: unknown): void {
    const suffix = details === undefined ? '' : ` ${this.serialize(details)}`
    const line = `${new Date().toISOString()} [${level}] [${scope}] ${message}${suffix}`
    if (!app.isPackaged) console.log(line)
    try {
      if (!this.directoryEnsured) {
        mkdirSync(dirname(this.filePath), { recursive: true })
        this.directoryEnsured = true
      }
      appendFileSync(this.filePath, `${line}\n`, 'utf8')
    } catch {
      // Logging must never break the app.
    }
  }

  private serialize(details: unknown): string {
    try {
      const text = typeof details === 'string' ? details : JSON.stringify(details)
      return text.length > DETAILS_LIMIT ? `${text.slice(0, DETAILS_LIMIT)}…(truncated)` : text
    } catch {
      return String(details)
    }
  }
}

export const logger = new Logger()
