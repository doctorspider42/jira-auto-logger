/**
 * Strategy interface implemented by every LLM backend.
 * Providers take a fully-built prompt and return the raw model text;
 * parsing and validation happen in LlmService.
 */
export interface LlmProvider {
  complete(prompt: string): Promise<string>
}
