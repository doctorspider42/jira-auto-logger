import { AppException } from '@shared/domain'
import type { LlmProvider } from './LlmProvider'
import { runCli } from './cliRunner'

const AUTH_ERROR_PATTERNS = [
  /not (logged in|authenticated)/i,
  /gh auth login/i,
  /copilot.{0,30}(login|authenticate)/i,
  /token.{0,20}(expired|invalid)/i
]

/** Runs prompts through the GitHub Copilot CLI in programmatic (`-p`) mode. */
export class CopilotCliProvider implements LlmProvider {
  constructor(
    private readonly cliPath: string,
    private readonly model: string
  ) {}

  async complete(prompt: string): Promise<string> {
    const args = ['-p', '-s']
    if (this.model) args.push('--model', this.model)
    const result = await runCli(this.cliPath, args, prompt)
    const combined = `${result.stdout}\n${result.stderr}`

    if (AUTH_ERROR_PATTERNS.some((p) => p.test(combined))) {
      throw new AppException('LLM_AUTH_EXPIRED', 'Copilot CLI session expired', combined.slice(0, 2000))
    }
    if (result.exitCode !== 0) {
      throw new AppException('LLM_FAILED', 'Copilot CLI failed', combined.slice(0, 2000))
    }
    return result.stdout
  }
}
