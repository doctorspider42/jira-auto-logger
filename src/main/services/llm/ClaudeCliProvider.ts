import { AppException } from '@shared/domain'
import type { LlmProvider } from './LlmProvider'
import { runCli } from './cliRunner'

const AUTH_ERROR_PATTERNS = [
  /invalid.{0,20}(api key|token)/i,
  /token.{0,20}expired/i,
  /not (logged in|authenticated)/i,
  /please run.{0,10}\/?login/i,
  /oauth.{0,20}(expired|revoked|invalid)/i,
  /authentication[_ ]error/i
]

/** Runs prompts through the Claude Code CLI in non-interactive (`-p`) mode. */
export class ClaudeCliProvider implements LlmProvider {
  constructor(
    private readonly cliPath: string,
    private readonly model: string,
    private readonly enableThinking: boolean
  ) {}

  async complete(prompt: string): Promise<string> {
    const args = ['-p', '--output-format', 'json']
    if (this.model) args.push('--model', this.model)
    const result = await runCli(this.cliPath, args, prompt, {
      // A zero thinking budget turns extended thinking off entirely.
      env: this.enableThinking ? undefined : { MAX_THINKING_TOKENS: '0' }
    })
    const combined = `${result.stdout}\n${result.stderr}`

    if (AUTH_ERROR_PATTERNS.some((p) => p.test(combined))) {
      throw new AppException('LLM_AUTH_EXPIRED', 'Claude CLI session expired', combined.slice(0, 2000))
    }

    // --output-format json wraps the answer in an envelope: { result: "..." }.
    try {
      const envelope = JSON.parse(result.stdout) as { result?: string; is_error?: boolean; subtype?: string }
      if (envelope.is_error) {
        throw new AppException('LLM_FAILED', `Claude CLI error: ${envelope.subtype ?? 'unknown'}`, result.stdout.slice(0, 2000))
      }
      if (typeof envelope.result === 'string') return envelope.result
    } catch (e) {
      if (e instanceof AppException) throw e
      // Fall through: some CLI versions print plain text despite the flag.
    }

    if (result.exitCode !== 0) {
      throw new AppException('LLM_FAILED', 'Claude CLI failed', combined.slice(0, 2000))
    }
    return result.stdout
  }
}
