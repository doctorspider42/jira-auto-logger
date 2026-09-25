/** Raw model answer plus the model that actually produced it, when the backend reports it. */
export interface LlmCompletion {
  text: string
  /**
   * Model id reported by the backend (e.g. `claude-opus-5-5` for the `opus`
   * alias). Falls back to the configured name when the backend doesn't say;
   * undefined when neither is known.
   */
  model?: string
}

/**
 * Strategy interface implemented by every LLM backend.
 * Providers take a fully-built prompt and return the raw model text;
 * parsing and validation happen in LlmService.
 */
export interface LlmProvider {
  complete(prompt: string): Promise<LlmCompletion>
}
