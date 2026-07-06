/** Mock mode: run the whole app on deterministic fake data, offline. */
export function isMockMode(): boolean {
  return process.env.JAL_MOCK === '1' || process.argv.includes('--mock')
}

export { mockConfig } from './data'
export { MockGitService, MockLlmProvider, mockJira, mockTempo } from './clients'
