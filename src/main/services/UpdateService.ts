import { app, BrowserWindow, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ReleaseNote, UpdateMode, UpdateState, UpdateStatus } from '@shared/domain'
import { UPDATES_STATE_EVENT } from '@shared/ipc'
import { logger } from './logger'
import { isMockMode } from './mock'

const REPO_OWNER = 'doctorspider42'
const REPO_NAME = 'jira-auto-logger'
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`
/** How long a fetched release history stays fresh, to avoid hammering the API. */
const HISTORY_CACHE_MS = 5 * 60 * 1000

/** Shape of the GitHub releases API entries we consume. */
interface GithubRelease {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  prerelease?: boolean
  draft?: boolean
}

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

  /** Short-lived cache of the fetched release history (see HISTORY_CACHE_MS). */
  private historyCache: { at: number; releases: ReleaseNote[] } | null = null

  /**
   * Transient failures (network/VPN/DNS not up yet at launch, a GitHub hiccup)
   * are retried with exponential backoff before the error banner is shown, so
   * a momentary blip right after launch never surfaces as an error.
   */
  private static readonly MAX_RETRIES = 4
  private static readonly RETRY_BASE_MS = 5000
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  /** Operation the retry timer re-runs; also collapses the duplicate failure
   *  signal (rejected promise + 'error' event) into a single retry. */
  private pendingOp: 'check' | 'download' | null = null

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
    // A user- or config-triggered check starts a fresh retry budget.
    this.resetRetry()
    return this.runCheck()
  }

  async download(): Promise<void> {
    if (!this.enabled || !this.canAutoUpdate) return
    this.resetRetry()
    return this.runDownload()
  }

  /** One check attempt; failures feed the retry loop, not the error banner. */
  private async runCheck(): Promise<void> {
    this.applyMode()
    this.pendingOp = 'check'
    try {
      if (this.canAutoUpdate) {
        await autoUpdater.checkForUpdates()
      } else {
        await this.checkViaGithub()
      }
    } catch (e) {
      // electron-updater also emits an 'error' event; guard the rejection too.
      this.onOperationFailed(e)
    }
  }

  /** One download attempt; failures feed the retry loop. */
  private async runDownload(): Promise<void> {
    this.pendingOp = 'download'
    this.setState({ status: 'downloading', progressPercent: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (e) {
      this.onOperationFailed(e)
    }
  }

  /**
   * Handles a failed check/download. Instead of surfacing an error at once, it
   * retries the operation with exponential backoff, staying in a non-error
   * status so no banner shows while retrying. The error reaches the UI only
   * once the retry budget is spent.
   */
  private onOperationFailed(e: unknown): void {
    // The auto-update path reports a failure twice (rejected promise AND an
    // 'error' event). A retry is already scheduled - ignore the duplicate.
    if (this.retryTimer) return
    const op = this.pendingOp
    if (op && this.retryCount < UpdateService.MAX_RETRIES) {
      const attempt = ++this.retryCount
      const delay = UpdateService.RETRY_BASE_MS * 2 ** (attempt - 1)
      logger.info(
        'update',
        `${op} failed, retry ${attempt}/${UpdateService.MAX_RETRIES} in ${delay}ms`,
        { error: errorText(e) }
      )
      // Hold a non-error status (checking / downloading) to keep the banner hidden.
      if (op === 'download') this.setState({ status: 'downloading' })
      else this.setState({ status: 'checking', errorMessage: '' })
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        void (op === 'download' ? this.runDownload() : this.runCheck())
      }, delay)
      return
    }
    // Out of retries (or nothing in flight): surface the failure.
    this.resetRetry()
    this.setState({ status: 'error', errorMessage: errorText(e) })
  }

  /** Clears any pending retry and resets the backoff counter. */
  private resetRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.retryCount = 0
    this.pendingOp = null
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
      this.resetRetry()
      this.setState({ status: 'available', availableVersion: info.version, releaseUrl: RELEASES_URL })
      // In `auto` mode electron-updater downloads on its own; reflect that and
      // keep the auto-download under the retry umbrella.
      if (this.getMode() === 'auto') {
        this.pendingOp = 'download'
        this.setState({ status: 'downloading', progressPercent: 0 })
      }
    })
    autoUpdater.on('update-not-available', () => {
      this.resetRetry()
      this.setState({ status: 'not-available' })
    })
    autoUpdater.on('download-progress', (progress) => {
      // Real progress means the connection is fine - restart the backoff.
      this.retryCount = 0
      this.setState({ status: 'downloading', progressPercent: Math.round(progress.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.resetRetry()
      this.setState({ status: 'downloaded', availableVersion: info.version, progressPercent: 100 })
    })
    autoUpdater.on('error', (err) => this.onOperationFailed(err))
  }

  /**
   * Published releases newest-first, for the "what's new" / version-history
   * view. Works on every platform (it is a read-only GitHub API call, unlike
   * the electron-updater self-update path). Cached briefly so reopening the
   * view does not re-hit the API. Drafts are excluded.
   */
  async getReleaseHistory(): Promise<ReleaseNote[]> {
    const now = Date.now()
    if (this.historyCache && now - this.historyCache.at < HISTORY_CACHE_MS) {
      return this.historyCache.releases
    }
    const raw = await this.githubGet<GithubRelease[]>('releases?per_page=30')
    const releases = (Array.isArray(raw) ? raw : [])
      .filter((r) => !r.draft)
      .map(
        (r): ReleaseNote => ({
          version: (r.tag_name ?? '').replace(/^v/, ''),
          name: r.name || r.tag_name || '',
          notes: (r.body ?? '').trim(),
          url: r.html_url || RELEASES_URL,
          publishedAt: r.published_at ?? '',
          prerelease: r.prerelease ?? false
        })
      )
    this.historyCache = { at: now, releases }
    return releases
  }

  /** macOS fallback: version-only check against the public releases API. */
  private async checkViaGithub(): Promise<void> {
    this.setState({ status: 'checking', errorMessage: '' })
    const release = await this.githubGet<GithubRelease>('releases/latest')
    const latest = (release.tag_name ?? '').replace(/^v/, '')
    this.resetRetry()
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

  /** GETs a public GitHub API path and parses the JSON response. */
  private githubGet<T>(path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'GET',
        url: `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/${path}`
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
            resolve(JSON.parse(body) as T)
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
