import { execFile } from 'child_process'
import { basename } from 'path'
import { promisify } from 'util'
import { AppException } from '@shared/domain'
import type { CommitInfo, GitFolder } from '@shared/domain'
import { logger } from './logger'

const execFileAsync = promisify(execFile)
// Explicit escapes (unit/record separator) - literal control chars in source
// are invisible and easy to lose in editors, which silently breaks parsing.
const FIELD_SEPARATOR = '\x1f'
const RECORD_SEPARATOR = '\x1e'

/** Anything that can provide commits for folders and dates (real git or mock). */
export interface CommitSource {
  getCommits(folderPaths: string[], dates: string[]): Promise<CommitInfo[]>
}

/** Reads commit history from local repositories using the system `git`. */
export class GitService implements CommitSource {
  constructor(private readonly getFolders: () => GitFolder[]) {}

  /**
   * Returns commits authored on any of the given ISO dates, across all
   * folders. Each folder has its own author filter; folders marked with
   * `includeAllAuthors` return everyone's commits.
   */
  async getCommits(folderPaths: string[], dates: string[]): Promise<CommitInfo[]> {
    if (folderPaths.length === 0 || dates.length === 0) return []
    const sorted = [...dates].sort()
    const since = `${sorted[0]}T00:00:00`
    const until = `${sorted[sorted.length - 1]}T23:59:59`
    const wanted = new Set(sorted)
    const configured = new Map(this.getFolders().map((f) => [f.path, f]))

    const results = await Promise.all(
      folderPaths.map((path) => {
        const folder = configured.get(path) ?? {
          path,
          label: basename(path),
          author: '',
          includeAllAuthors: false
        }
        return this.getRepoCommits(folder, since, until)
      })
    )
    return results
      .flat()
      .filter((c) => wanted.has(c.date.slice(0, 10)))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  private async getRepoCommits(folder: GitFolder, since: string, until: string): Promise<CommitInfo[]> {
    // Legacy configs may have an empty author; fall back to the repo's own user.
    const author = folder.includeAllAuthors
      ? ''
      : folder.author || (await this.getRepoUserEmail(folder.path))
    const args = [
      'log',
      '--all',
      `--since=${since}`,
      `--until=${until}`,
      `--pretty=format:%H${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%s${RECORD_SEPARATOR}`
    ]
    if (author) args.push(`--author=${author}`)

    const stdout = await this.git(folder.path, args)
    const label = folder.label || basename(folder.path)
    const commits = stdout
      .split(RECORD_SEPARATOR)
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [hash, date, message] = record.split(FIELD_SEPARATOR)
        return { hash, date, message, repoLabel: label }
      })
      // Guard against malformed records so one odd line cannot crash parsing.
      .filter((c) => Boolean(c.hash && c.date && c.message !== undefined))
    logger.debug('git', `${label}: ${commits.length} commits`, { author: author || '(all)' })
    return commits
  }

  private async getRepoUserEmail(folder: string): Promise<string> {
    try {
      return (await this.git(folder, ['config', 'user.email'])).trim()
    } catch {
      return ''
    }
  }

  private async git(folder: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['-C', folder, ...args], {
        maxBuffer: 16 * 1024 * 1024
      })
      return stdout
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (message.includes('not a git repository')) {
        throw new AppException('GIT_NOT_A_REPO', `Not a git repository: ${folder}`)
      }
      throw new AppException('GIT_FAILED', `git failed in ${folder}`, message)
    }
  }
}
