import { AppException } from '@shared/domain'
import type { OpenAiConfig } from '@shared/domain'
import { logger } from '../logger'
import type { LlmProvider } from './LlmProvider'

interface ChatCompletionDto {
  choices: Array<{ message: { content: string } }>
}

/** Calls the OpenAI Chat Completions API (or any compatible endpoint). */
export class OpenAiApiProvider implements LlmProvider {
  constructor(
    private readonly config: OpenAiConfig,
    private readonly enableThinking: boolean
  ) {}

  /**
   * Effort sent to reasoning models when thinking is disabled. Non-reasoning
   * models reject the parameter, so it is only sent when the model name
   * clearly indicates a reasoning family.
   */
  private reasoningEffort(model: string): string | null {
    if (this.enableThinking) return null
    if (/^gpt-5/i.test(model)) return 'minimal'
    if (/^o\d/i.test(model)) return 'low'
    return null
  }

  async complete(prompt: string): Promise<string> {
    const { apiKey, model, baseUrl } = this.config
    if (!apiKey) {
      throw new AppException('CONFIG_INVALID', 'OpenAI API key is not configured')
    }
    const url = `${(baseUrl || 'https://api.openai.com').replace(/\/$/, '')}/v1/chat/completions`
    const startedAt = Date.now()
    logger.info('openai', `POST ${url}`, { model: model || 'gpt-4o-mini', promptLength: prompt.length })

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          ...(this.reasoningEffort(model)
            ? { reasoning_effort: this.reasoningEffort(model) }
            : {})
        })
      })
    } catch (e) {
      throw new AppException('LLM_FAILED', 'Cannot reach the OpenAI API', String(e))
    }
    logger.info('openai', `HTTP ${response.status} in ${Date.now() - startedAt}ms`)
    if (response.status === 401) {
      throw new AppException('LLM_AUTH_EXPIRED', 'OpenAI rejected the API key')
    }
    if (!response.ok) {
      throw new AppException('LLM_FAILED', `OpenAI returned HTTP ${response.status}`, await response.text())
    }
    const dto = (await response.json()) as ChatCompletionDto
    const content = dto.choices?.[0]?.message?.content
    if (!content) {
      throw new AppException('LLM_BAD_RESPONSE', 'OpenAI returned an empty response')
    }
    return content
  }
}
