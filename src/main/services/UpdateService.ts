import { app, BrowserWindow, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateMode, UpdateState, UpdateStatus } from '@shared/domain'
import { UPDATES_STATE_EVENT } from '@shared/ipc'
import { logger } from './logger'
import { isMockMode } from './mock'

const REPO_OWNER = 'doctorspider42'
const REPO_NAME = 'jira-auto-logger'
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`

/** Compares two dotted version strings; true when `a` is strictly newer than `b`. */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

/**
 * Drives auto-update. On Windows and Linux it uses electron-updater against
 * the public GitHub releases (no token needed). macOS builds are unsigned and
 * cannot self-update, so there we only compare versions via the GitHub API and
 * point the user at the releases page for a manual download.
 *
 * Every state transition is broadcast to all renderer windows over
 * `UPDATES_STATE_EVENT`; the current snapshot is also available synchronously
 * via `getState()` so a renderer mounting after a transition never misses it.
 */
export class UpdateService {
  /** Auto-download/-install only works on signed-capable, packaged, non-mac builds. */
  private readonly canAutoUpdate = process.platform !== 'darwin' && app.isPackaged
  /** Whether the updater does anything at all (never in dev or mock mode). */
  private readonly enabled = app.isPackaged && !isMockMode()

  private state: UpdateState = {
    status: 'idle',
    currentVersion: app.getVersion(),
    availableVersion: '',
    progressPercent: 0,
    releaseUrl: '',
    canAutoUpdate: this.canAutoUpdate,
    errorMessage: ''
  }

  constructor(private readonly getMode: () => UpdateMode) {
    if (this.canAutoUpdate) this.wireAutoUpdater()
  }

  getState(): UpdateState {
    return this.state
  }

  /** Kicks off the initial check shortly after launch, unless mode is `off`. */
  start(): void {
    if (!this.enabled) {
      logger.info('update', 'Updater disabled (dev or mock mode)')
      return
    }
    this.applyMode()
    if (this.getMode() === 'off') return
    // Give the window a moment to mount its listener before the first check.
    setTimeout(() => void this.check(), 4000)
  }

  /** Re-reads the mode after a config change and checks if it was just enabled. */
  onConfigChanged(): void {
    if (!this.enabled) return
    this.applyMode()
    const idle = this.state.status === 'idle' || this.state.status === 'not-available'
    if (this.getMode() !== 'off' && idle) void this.check()
  }

  async check(): Promise<void> {
    if (!this.enabled) return
    this.applyMode()
    try {
      if (this.canAutoUpdate) {
        await autoUpdater.checkForUpdates()
      } else {
        await this.checkViaGithub()
      }
    } catch (e) {
      // electron-updater also emits an 'error' event; guard the rejection too.
      this.setState({ status: 'error', errorMessage: errorText(e) })
    }
  }

  async download(): Promise<void> {
    if (!this.enabled || !this.canAutoUpdate) return
    this.setState({ status: 'downloading', progressPercent: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (e) {
      this.setState({ status: 'error', errorMessage: errorText(e) })
    }
  }

  quitAndInstall(): void {
    if (!this.enabled || !this.canAutoUpdate) return
    // isSilent=false shows the installer UI; isForceRunAfter relaunches the app.
    autoUpdater.quitAndInstall(false, true)
  }

  /** Applies the configured mode to electron-updater's auto flags. */
  private applyMode(): void {
    if (!this.canAutoUpdate) return
    const mode = this.getMode()
    // We drive downloads ourselves so we can show progress and let the user
    // decide; in `auto` mode we let it download and install on quit.
    autoUpdater.autoDownload = mode === 'auto'
    autoUpdater.autoInstallOnAppQuit = mode === 'auto'
  }

  private wireAutoUpdater(): void {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.logger = {
      info: (m: unknown) => logger.info('update', String(m)),
      warn: (m: unknown) => logger.info('update', String(m)),
      error: (m: unknown) => logger.error('update', String(m)),
      debug: (m: unknown) => logger.debug('update', String(m))
    }

    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking', errorMessage: '' }))
    autoUpdater.on('update-available', (info) => {
      this.setState({ status: 'available', availableVersion: info.version, releaseUrl: RELEASES_URL })
      // In `auto` mode electron-updater downloads on its own; reflect that.
      if (this.getMode() === 'auto') this.setState({ status: 'downloading', progressPercent: 0 })
    })
    autoUpdater.on('update-not-available', () => this.setState({ status: 'not-available' }))
    autoUpdater.on('download-progress', (progress) =>
      this.setState({ status: 'downloading', progressPercent: Math.round(progress.percent) })
    )
    autoUpdater.on('update-downloaded', (info) =>
      this.setState({ status: 'downloaded', availableVersion: info.version, progressPercent: 100 })
    )
    autoUpdater.on('error', (err) => this.setState({ status: 'error', errorMessage: errorText(err) }))
  }

  /** macOS fallback: version-only check against the public releases API. */
  private async checkViaGithub(): Promise<void> {
    this.setState({ status: 'checking', errorMessage: '' })
    const release = await this.fetchLatestRelease()
    const latest = release.tag_name.replace(/^v/, '')
    if (latest && isNewer(latest, app.getVersion())) {
      this.setState({
        status: 'available',
        availableVersion: latest,
        releaseUrl: release.html_url || RELEASES_URL
      })
    } else {
      this.setState({ status: 'not-available' })
    }
  }

  private fetchLatestRelease(): Promise<{ tag_name: string; html_url: string }> {
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'GET',
        url: `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`
      })
      request.setHeader('Accept', 'application/vnd.github+json')
      // GitHub rejects requests without a User-Agent.
      request.setHeader('User-Agent', `${REPO_NAME}/${app.getVersion()}`)
      let body = ''
      request.on('response', (response) => {
        response.on('data', (chunk) => (body += chunk.toString()))
        response.on('end', () => {
          const code = response.statusCode ?? 0
          if (code >= 400) {
            reject(new Error(`GitHub API returned ${code}`))
            return
          }
          try {
            const json = JSON.parse(body) as { tag_name?: string; html_url?: string }
            resolve({ tag_name: json.tag_name ?? '', html_url: json.html_url ?? '' })
          } catch (e) {
            reject(e)
          }
        })
      })
      request.on('error', reject)
      request.end()
    })
  }

  private setState(patch: Partial<UpdateState> & { status: UpdateStatus }): void {
    this.state = { ...this.state, ...patch }
    logger.info('update', `state ${this.state.status}`, {
      version: this.state.availableVersion,
      percent: this.state.progressPercent
    })
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(UPDATES_STATE_EVENT, this.state)
    }
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
