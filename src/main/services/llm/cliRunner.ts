import { spawn } from 'child_process'
import { AppException } from '@shared/domain'
import { logger } from '../logger'

export interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface CliOptions {
  timeoutMs?: number
  /** Extra environment variables merged over the current process env. */
  env?: Record<string, string>
}

/**
 * Runs a CLI tool feeding the prompt through stdin (avoids OS argv length
 * limits and quoting issues with large prompts).
 */
export function runCli(command: string, args: string[], stdin: string, options: CliOptions = {}): Promise<CliResult> {
  const { timeoutMs = 180_000, env } = options
  const startedAt = Date.now()
  logger.info('cli', `spawn: ${command} ${args.join(' ')}`, {
    stdinLength: stdin.length,
    ...(env ? { env: Object.keys(env) } : {})
  })
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      // `shell` lets Windows resolve .cmd/.ps1 shims that npm-installed CLIs use.
      shell: process.platform === 'win32',
      windowsHide: true,
      env: env ? { ...process.env, ...env } : process.env
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new AppException('LLM_FAILED', `${command} timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (error.code === 'ENOENT') {
        reject(new AppException('LLM_CLI_NOT_FOUND', `CLI not found: ${command}`))
      } else {
        reject(new AppException('LLM_FAILED', `Failed to start ${command}`, error.message))
      }
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      logger.info('cli', `${command} exited ${code} in ${Date.now() - startedAt}ms`, {
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
        ...(code !== 0 ? { stderr: stderr.slice(0, 1000) } : {})
      })
      if (code !== 0 && stdout.trim() === '' && /not (found|recognized)/i.test(stderr)) {
        reject(new AppException('LLM_CLI_NOT_FOUND', `CLI not found: ${command}`, stderr))
        return
      }
      resolve({ stdout, stderr, exitCode: code ?? -1 })
    })

    child.stdin.write(stdin, 'utf8')
    child.stdin.end()
  })
}
