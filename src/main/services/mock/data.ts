import type { AppConfig, JiraIssue, TempoWorkAttribute, Worklog } from '@shared/domain'
import { DEFAULT_MAIN_PROMPT } from '../defaultPrompt'

/**
 * Deterministic fake data for mock mode (JAL_MOCK=1): two Jira connections,
 * three projects, issues, six weeks of Tempo history and work attributes.
 * Everything lives in memory; nothing is persisted or sent anywhere.
 */

export const CONN_MAIN = 'mock-conn-acme'
export const CONN_CLIENT = 'mock-conn-client'

/** Seeded PRNG so mock data (and screenshots) are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function mockConfig(): AppConfig {
  return {
    connections: [
      {
        id: CONN_MAIN,
        name: 'Acme (company)',
        jira: { baseUrl: 'https://acme.atlassian.net', email: 'dev@acme.dev', apiToken: 'mock' },
        tempo: { apiToken: 'mock' }
      },
      {
        id: CONN_CLIENT,
        name: 'Client X',
        jira: { baseUrl: 'https://clientx.atlassian.net', email: 'dev@acme.dev', apiToken: 'mock' },
        tempo: { apiToken: 'mock' }
      }
    ],
    activeConnectionIds: [CONN_MAIN, CONN_CLIENT],
    projects: [
      {
        id: 'mock-project-app',
        name: 'Mobile App',
        connectionId: CONN_MAIN,
        jiraProjectKey: 'APP',
        gitFolder: {
          path: 'C:\\dev\\mobile-app',
          label: 'mobile-app',
          author: 'dev@acme.dev',
          includeAllAuthors: false
        },
        instruction: 'Prefer logging to stories over the epic.',
        color: '#6d9eff'
      },
      {
        id: 'mock-project-int',
        name: 'Internal Tools',
        connectionId: CONN_MAIN,
        jiraProjectKey: 'INT',
        gitFolder: null,
        instruction: '',
        color: '#ffc857'
      },
      {
        id: 'mock-project-shop',
        name: 'Client X Shop',
        connectionId: CONN_CLIENT,
        jiraProjectKey: 'SHOP',
        gitFolder: {
          path: 'C:\\dev\\shop-frontend',
          label: 'shop-frontend',
          author: 'dev@acme.dev',
          includeAllAuthors: false
        },
        instruction: 'Descriptions must be client-friendly, no internal jargon.',
        color: '#4fd28a'
      }
    ],
    customFields: [
      {
        id: 'mock-field-overtime',
        connectionId: CONN_MAIN,
        key: '_Overtime_',
        label: 'Overtime',
        type: 'boolean',
        autoFill: true,
        instruction: 'Set only when the notes explicitly mention overtime.',
        showInCalendar: true,
        calendarIcon: '🔥'
      },
      {
        id: 'mock-field-remote',
        connectionId: CONN_CLIENT,
        key: '_Remote_',
        label: 'Remote work',
        type: 'boolean',
        autoFill: true,
        instruction: '',
        showInCalendar: true,
        calendarIcon: '🏠'
      }
    ],
    llm: {
      backend: 'claude-cli',
      openAi: { apiKey: '', model: 'gpt-4o-mini', baseUrl: '' },
      claudeCliPath: 'claude',
      claudeModel: '',
      copilotCliPath: 'copilot',
      copilotModel: '',
      mainPrompt: DEFAULT_MAIN_PROMPT,
      enableThinking: true
    },
    language: 'en',
    themeId: 'dark',
    workingHoursPerDay: 8,
    issuePool: { lookbackDays: 60, maxIssues: 100 },
    lastUsed: { selections: [] }
  }
}

const issue = (
  id: number,
  key: string,
  summary: string,
  typeName: string,
  isSubtask = false
): JiraIssue => ({ id: String(id), key, summary, typeName, isSubtask })

export const MOCK_ISSUES: Record<string, JiraIssue[]> = {
  APP: [
    issue(10101, 'APP-101', 'Implement biometric login', 'Story'),
    issue(10102, 'APP-102', 'Crash on Android 15 when opening camera', 'Bug'),
    issue(10103, 'APP-103', 'Push notification settings screen', 'Story'),
    issue(10104, 'APP-104', 'Refactor session storage', 'Task'),
    issue(10105, 'APP-105', 'Migrate to SDK 52', 'Epic'),
    issue(10106, 'APP-106', 'Write UI tests for the login flow', 'Sub-task', true),
    issue(10107, 'APP-107', 'Dark mode for the paywall screens', 'Story')
  ],
  INT: [
    issue(10201, 'INT-11', 'Quarterly access review automation', 'Task'),
    issue(10202, 'INT-12', 'Flaky tests in the CI pipeline', 'Bug'),
    issue(10203, 'INT-13', 'Onboarding checklist app', 'Story')
  ],
  SHOP: [
    issue(10301, 'SHOP-201', 'Checkout: BLIK payments', 'Story'),
    issue(10302, 'SHOP-202', 'Cart total rounding bug', 'Bug'),
    issue(10303, 'SHOP-203', 'Product page redesign', 'Epic'),
    issue(10304, 'SHOP-204', 'Discount codes service', 'Story'),
    issue(10305, 'SHOP-205', 'Update GDPR consent banner', 'Task')
  ]
}

export const PROJECTS_BY_CONNECTION: Record<string, Array<{ key: string; name: string }>> = {
  [CONN_MAIN]: [
    { key: 'APP', name: 'Mobile App' },
    { key: 'INT', name: 'Internal Tools' },
    { key: 'HR', name: 'HR Requests' }
  ],
  [CONN_CLIENT]: [
    { key: 'SHOP', name: 'Client X Shop' },
    { key: 'CRM', name: 'Client X CRM' }
  ]
}

export const WORK_ATTRIBUTES: Record<string, TempoWorkAttribute[]> = {
  [CONN_MAIN]: [
    { key: '_Overtime_', name: 'Overtime', type: 'CHECKBOX' },
    { key: '_OnCall_', name: 'On call', type: 'CHECKBOX' },
    { key: '_Notes_', name: 'Billing notes', type: 'INPUT_FIELD' }
  ],
  [CONN_CLIENT]: [
    { key: '_Remote_', name: 'Remote work', type: 'CHECKBOX' },
    { key: '_Phase_', name: 'Project phase', type: 'INPUT_FIELD' }
  ]
}

const DESCRIPTIONS: Record<string, string[]> = {
  APP: [
    'Implemented the biometric login flow and error states',
    'Fixed the camera crash reported on Android 15',
    'Built the notification settings screen',
    'Refactored session storage to encrypted preferences',
    'Reviewed pull requests and updated UI tests'
  ],
  INT: [
    'Automated the quarterly access review export',
    'Stabilized flaky integration tests in CI',
    'Prepared the onboarding checklist data model'
  ],
  SHOP: [
    'Integrated BLIK payment confirmation in checkout',
    'Fixed rounding of cart totals for mixed VAT rates',
    'Implemented the redesigned product gallery',
    'Extended the discount codes service with expiry rules',
    'Updated the GDPR consent banner texts'
  ]
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10)

/** Six weeks of plausible weekday history for one connection. */
export function generateWorklogs(connectionId: string): Worklog[] {
  const projectKeys = connectionId === CONN_MAIN ? ['APP', 'INT'] : ['SHOP']
  const random = mulberry32(connectionId === CONN_MAIN ? 1337 : 4242)
  const worklogs: Worklog[] = []
  let id = connectionId === CONN_MAIN ? 90_000 : 95_000

  const today = new Date()
  for (let daysBack = 1; daysBack <= 42; daysBack++) {
    const day = new Date(today.getTime() - daysBack * 86_400_000)
    if (day.getDay() === 0 || day.getDay() === 6) continue
    // The client project is worked on ~3 days a week.
    if (connectionId === CONN_CLIENT && random() < 0.4) continue

    const splits = random() < 0.6 ? [5, 3] : [8]
    for (const hours of splits) {
      const projectKey = projectKeys[Math.floor(random() * projectKeys.length)]
      const issues = MOCK_ISSUES[projectKey]
      const picked = issues[Math.floor(random() * issues.length)]
      const texts = DESCRIPTIONS[projectKey]
      const overtime = random() < 0.15
      worklogs.push({
        tempoWorklogId: id++,
        issueId: picked.id,
        issueKey: picked.key,
        issueSummary: picked.summary,
        description: texts[Math.floor(random() * texts.length)],
        timeSpentSeconds: hours * 3600,
        startDate: isoDate(day),
        attributes:
          connectionId === CONN_MAIN
            ? [{ key: '_Overtime_', value: overtime }]
            : [{ key: '_Remote_', value: random() < 0.5 }]
      })
    }
  }
  return worklogs
}
