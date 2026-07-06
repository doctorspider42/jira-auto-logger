import { AppException } from '@shared/domain'
import type { AppConfig, JiraConnection } from '@shared/domain'
import { JiraClient } from './JiraClient'
import type { JiraApi } from './JiraClient'
import { TempoClient, parseWorkdayStart } from './TempoClient'
import type { TempoApi } from './TempoClient'
import { isMockMode, mockJira, mockTempo } from './mock'

/**
 * Resolves connection ids to per-connection API clients. Clients are cached
 * per id and read their credentials lazily, so config edits take effect
 * without restarting anything.
 */
export class ConnectionManager {
  private readonly jiraClients = new Map<string, JiraApi>()
  private readonly tempoClients = new Map<string, TempoApi>()
  private readonly accountIds = new Map<string, { credentialsKey: string; accountId: string }>()

  constructor(private readonly getConfig: () => AppConfig) {}

  connection(id: string): JiraConnection {
    const connection = this.getConfig().connections.find((c) => c.id === id)
    if (!connection) {
      throw new AppException('CONFIG_INVALID', `Unknown Jira connection: ${id}`)
    }
    return connection
  }

  jira(id: string): JiraApi {
    let client = this.jiraClients.get(id)
    if (!client) {
      client = isMockMode() ? mockJira(id) : new JiraClient(() => this.connection(id).jira)
      this.jiraClients.set(id, client)
    }
    return client
  }

  tempo(id: string): TempoApi {
    let client = this.tempoClients.get(id)
    if (!client) {
      client = isMockMode()
        ? mockTempo(id)
        : new TempoClient(() => this.connection(id).tempo, this.jira(id), () =>
            parseWorkdayStart(this.getConfig().workdayStart)
          )
      this.tempoClients.set(id, client)
    }
    return client
  }

  /** Jira accountId of the connection's user, cached until credentials change. */
  async accountId(id: string): Promise<string> {
    const { baseUrl, email } = this.connection(id).jira
    const credentialsKey = `${baseUrl}|${email}`
    const cached = this.accountIds.get(id)
    if (cached?.credentialsKey === credentialsKey) return cached.accountId

    const accountId = (await this.jira(id).getMyself()).accountId
    this.accountIds.set(id, { credentialsKey, accountId })
    return accountId
  }
}
