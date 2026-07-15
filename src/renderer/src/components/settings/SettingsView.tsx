import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AppConfig,
  AppError,
  CustomFieldConfig,
  JiraConnection,
  LlmBackendId,
  TempoWorkAttribute
} from '@shared/domain'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { useAppStore } from '@/store/appStore'
import { THEMES } from '@/theme/themes'
import { openExternal } from '@/utils/external'
import { ModelSelect } from './ModelSelect'
import './settings.css'

/** Applies a partial update to a nested config section immutably. */
type SectionPatch<K extends keyof AppConfig> = Partial<AppConfig[K]>

/**
 * Models known to work with each backend at the time of this release.
 * The "custom" option in ModelSelect covers anything newer.
 */
const BACKEND_MODELS: Record<LlmBackendId, string[]> = {
  'claude-cli': ['fable', 'opus', 'sonnet', 'haiku'],
  'copilot-cli': ['claude-sonnet-4.5', 'gpt-5', 'gpt-5-codex', 'gemini-2.5-pro'],
  'openai-api': ['gpt-5.1', 'gpt-5.1-mini', 'gpt-5', 'gpt-5-mini', 'gpt-4o', 'gpt-4o-mini']
}

const JIRA_TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens'
const TEMPO_TOKEN_HELP_URL = 'https://help.tempo.io/timesheets/latest/rest-api-access-tokens'

/** Icons available for the "show in calendar" marker of a custom field. */
const CALENDAR_ICONS = ['⭐', '🔥', '🏠', '💰', '🌙', '🚨', '📞', '✈️', '🎓', '🐛', '🖌️']

/** Sections listed in the side navigation, in document order. */
const SETTINGS_SECTIONS = [
  { id: 'connections', labelKey: 'settings.sectionConnections' },
  { id: 'llm', labelKey: 'settings.sectionLlm' },
  { id: 'appearance', labelKey: 'settings.sectionAppearance' },
  { id: 'updates', labelKey: 'settings.sectionUpdates' }
] as const

/** Deep link to the API Integration page of the user's own Tempo instance. */
function tempoTokenUrl(jiraBaseUrl: string): string {
  if (!jiraBaseUrl) return TEMPO_TOKEN_HELP_URL
  const base = jiraBaseUrl.replace(/\/+$/, '')
  return `${base}/plugins/servlet/ac/io.tempo.jira/tempo-app#!/configuration/api-integration`
}

interface ConnectionTest {
  jira?: { name?: string; error?: AppError }
  tempo?: { skipped?: boolean; error?: AppError }
}

export function SettingsView(): JSX.Element {
  const { t } = useTranslation()
  const saved = useAppStore((s) => s.config)
  const saveConfig = useAppStore((s) => s.saveConfig)
  const update = useAppStore((s) => s.update)
  const [checking, setChecking] = useState(false)

  const [draft, setDraft] = useState<AppConfig>(() => structuredClone(saved))
  const [tests, setTests] = useState<Record<string, ConnectionTest>>({})
  const [testingId, setTestingId] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [showBlockReason, setShowBlockReason] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [configPath, setConfigPath] = useState('')
  const [logPath, setLogPath] = useState('')

  const [activeSection, setActiveSection] = useState<string>(SETTINGS_SECTIONS[0].id)

  useEffect(() => {
    void window.api.config.getFilePath().then(setConfigPath)
    void window.api.config.getLogFilePath().then(setLogPath)
  }, [])

  // Highlight the section currently scrolled into view in the side nav. The
  // scroll container is `.app-main`; the bottom margin biases toward the
  // section near the top of the viewport rather than whatever is centred.
  useEffect(() => {
    const root = document.querySelector('.app-main')
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        const onScreen = entries.filter((e) => e.isIntersecting)
        if (onScreen.length === 0) return
        const topmost = onScreen.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b
        )
        setActiveSection(topmost.target.id.replace('settings-section-', ''))
      },
      { root, rootMargin: '0px 0px -65% 0px', threshold: 0 }
    )
    for (const section of SETTINGS_SECTIONS) {
      const el = document.getElementById(`settings-section-${section.id}`)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  const goToSection = (id: string): void =>
    document
      .getElementById(`settings-section-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved])

  const patch = (changes: Partial<AppConfig>): void => setDraft((d) => ({ ...d, ...changes }))
  const patchSection = <K extends keyof AppConfig>(key: K, changes: SectionPatch<K>): void =>
    setDraft((d) => ({ ...d, [key]: { ...(d[key] as object), ...changes } }))

  const patchConnection = (id: string, update: (c: JiraConnection) => JiraConnection): void =>
    setDraft((d) => ({
      ...d,
      connections: d.connections.map((c) => (c.id === id ? update(c) : c))
    }))

  const addConnection = (): void => {
    const connection: JiraConnection = {
      id: crypto.randomUUID(),
      name: '',
      jira: { baseUrl: '', email: '', apiToken: '' },
      tempo: { apiToken: '' }
    }
    setDraft((d) => ({
      ...d,
      connections: [...d.connections, connection],
      activeConnectionIds: [...d.activeConnectionIds, connection.id]
    }))
  }

  const removeConnection = (id: string): void =>
    setDraft((d) => ({
      ...d,
      connections: d.connections.filter((c) => c.id !== id),
      activeConnectionIds: d.activeConnectionIds.filter((a) => a !== id)
    }))

  const testConnection = async (connection: JiraConnection): Promise<void> => {
    setTests((all) => ({ ...all, [connection.id]: {} }))
    setTestingId(connection.id)
    // Test with the draft values, not the saved ones.
    await saveConfig(draft)

    const jiraResult = await window.api.jira.testConnection(connection.id)
    if (!jiraResult.ok) {
      // Tempo needs the Jira accountId, so there is nothing more to test.
      setTests((all) => ({ ...all, [connection.id]: { jira: { error: jiraResult.error } } }))
      setTestingId(null)
      return
    }

    const result: ConnectionTest = { jira: { name: jiraResult.value.displayName } }
    if (connection.tempo.apiToken) {
      const tempoResult = await window.api.tempo.testConnection(connection.id)
      result.tempo = tempoResult.ok ? {} : { error: tempoResult.error }
    } else {
      result.tempo = { skipped: true }
    }
    setTests((all) => ({ ...all, [connection.id]: result }))
    setTestingId(null)
  }

  // ---------- Custom fields ----------

  const [workAttributes, setWorkAttributes] = useState<Record<string, TempoWorkAttribute[]>>({})
  const [importingConnectionId, setImportingConnectionId] = useState<string | null>(null)
  const [importError, setImportError] = useState<AppError | null>(null)

  const importWorkAttributes = async (connectionId: string): Promise<void> => {
    setImportingConnectionId(connectionId)
    setImportError(null)
    // Fetch with the draft credentials, not the saved ones.
    await saveConfig(draft)
    const result = await window.api.tempo.getWorkAttributes(connectionId)
    setImportingConnectionId(null)
    if (result.ok) {
      setWorkAttributes((all) => ({ ...all, [connectionId]: result.value }))
    } else {
      setImportError(result.error)
    }
  }

  const addFieldFromAttribute = (connectionId: string, attribute: TempoWorkAttribute): void =>
    patch({
      customFields: [
        ...draft.customFields,
        {
          id: crypto.randomUUID(),
          connectionId,
          key: attribute.key,
          label: attribute.name,
          type: attribute.type === 'CHECKBOX' ? 'boolean' : 'string',
          autoFill: true,
          instruction: '',
          showInCalendar: false,
          calendarIcon: ''
        }
      ]
    })

  const addFieldManually = (connectionId: string): void =>
    patch({
      customFields: [
        ...draft.customFields,
        {
          id: crypto.randomUUID(),
          connectionId,
          key: '',
          label: '',
          type: 'string',
          autoFill: true,
          instruction: '',
          showInCalendar: false,
          calendarIcon: ''
        }
      ]
    })

  const patchField = (id: string, changes: Partial<CustomFieldConfig>): void =>
    patch({ customFields: draft.customFields.map((f) => (f.id === id ? { ...f, ...changes } : f)) })

  const removeField = (id: string): void =>
    patch({ customFields: draft.customFields.filter((f) => f.id !== id) })

  const invalidCustomFields = draft.customFields.filter(
    (f) =>
      !f.key.trim() ||
      !f.label.trim() ||
      !draft.connections.some((c) => c.id === f.connectionId)
  )

  /** Fields whose connection was removed in this draft - shown for cleanup. */
  const orphanedFields = draft.customFields.filter(
    (f) => !draft.connections.some((c) => c.id === f.connectionId)
  )

  const saveBlocked = invalidCustomFields.length > 0
  const saveBlockedReason = saveBlocked ? t('settings.fieldRequired') : undefined

  const checkForUpdates = async (): Promise<void> => {
    setChecking(true)
    // Persist the mode first so the check honours the current selection.
    if (dirty) await saveConfig(draft)
    await window.api.updates.check()
    setChecking(false)
  }

  /** One-line status shown next to the "check now" button. */
  const updateStatusText = (): string | null => {
    if (!update) return null
    switch (update.status) {
      case 'checking':
        return t('updates.statusChecking')
      case 'available':
        return t('updates.available', { version: update.availableVersion })
      case 'downloading':
        return t('updates.downloading', { percent: update.progressPercent })
      case 'downloaded':
        return t('updates.ready', { version: update.availableVersion })
      case 'not-available':
        return t('updates.statusUpToDate')
      case 'error':
        return t('updates.statusError')
      default:
        return null
    }
  }

  const save = async (): Promise<void> => {
    // The button stays clickable even when blocked so the reason is reachable;
    // clicking while blocked just surfaces why instead of silently doing nothing.
    if (saveBlocked) {
      setShowBlockReason(true)
      return
    }
    setError(null)
    const result = await saveConfig(draft)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2500)
  }

  /** Reverts every unsaved edit back to the persisted config. */
  const discard = (): void => {
    setDraft(structuredClone(saved))
    setError(null)
    setShowBlockReason(false)
  }

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={t('settings.title')}>
        {SETTINGS_SECTIONS.map((section) => (
          <button
            key={section.id}
            className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`}
            onClick={() => goToSection(section.id)}
          >
            {t(section.labelKey)}
          </button>
        ))}
      </nav>

      <div className="settings">
      {error && <ErrorBanner error={error} />}

      <section id="settings-section-connections" className="card settings-section">
        <h3>{t('settings.sectionConnections')}</h3>
        <p className="hint">{t('settings.connectionsHint')}</p>
        {draft.connections.map((connection) => {
          const test = tests[connection.id]
          const fields = draft.customFields.filter((f) => f.connectionId === connection.id)
          const attributes = workAttributes[connection.id]
          const importable = (attributes ?? []).filter((a) => !fields.some((f) => f.key === a.key))
          return (
            <div key={connection.id} className="connection-card">
              <div className="field-row">
                <div className="field">
                  <label>{t('settings.connectionName')}</label>
                  <input
                    value={connection.name}
                    placeholder={t('settings.connectionNamePlaceholder')}
                    onChange={(e) =>
                      patchConnection(connection.id, (c) => ({ ...c, name: e.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label>{t('settings.jiraBaseUrl')}</label>
                  <input
                    value={connection.jira.baseUrl}
                    onChange={(e) =>
                      patchConnection(connection.id, (c) => ({
                        ...c,
                        jira: { ...c.jira, baseUrl: e.target.value.trim() }
                      }))
                    }
                    spellCheck={false}
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>{t('settings.jiraEmail')}</label>
                  <input
                    value={connection.jira.email}
                    onChange={(e) =>
                      patchConnection(connection.id, (c) => ({
                        ...c,
                        jira: { ...c.jira, email: e.target.value.trim() }
                      }))
                    }
                    spellCheck={false}
                  />
                </div>
                <div className="field">
                  <div className="wizard-label-row">
                    <label>{t('settings.jiraApiToken')}</label>
                    <button className="btn btn-ghost btn-sm" onClick={() => openExternal(JIRA_TOKEN_URL)}>
                      {t('settings.getToken')}
                    </button>
                  </div>
                  <input
                    type="password"
                    value={connection.jira.apiToken}
                    onChange={(e) =>
                      patchConnection(connection.id, (c) => ({
                        ...c,
                        jira: { ...c.jira, apiToken: e.target.value.trim() }
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <div className="wizard-label-row">
                    <label>{t('settings.tempoApiToken')}</label>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => openExternal(tempoTokenUrl(connection.jira.baseUrl))}
                    >
                      {t('settings.getToken')}
                    </button>
                  </div>
                  <input
                    type="password"
                    value={connection.tempo.apiToken}
                    onChange={(e) =>
                      patchConnection(connection.id, (c) => ({
                        ...c,
                        tempo: { apiToken: e.target.value.trim() }
                      }))
                    }
                  />
                </div>
              </div>
              <div className="settings-test-row">
                <button
                  className="btn"
                  onClick={() => testConnection(connection)}
                  disabled={testingId !== null}
                >
                  {testingId === connection.id && <span className="spinner" />}
                  {t('settings.testConnection')}
                </button>
                {test?.jira && !test.jira.error && (
                  <span className="settings-test-ok">
                    ✓ {t('settings.connectionOk', { name: test.jira.name })}
                  </span>
                )}
                {test?.tempo && !test.tempo.error && !test.tempo.skipped && (
                  <span className="settings-test-ok">✓ {t('settings.tempoOk')}</span>
                )}
                {test?.tempo?.skipped && <span className="hint">{t('settings.tempoSkipped')}</span>}
                <span style={{ flex: 1 }} />
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => removeConnection(connection.id)}
                >
                  {t('settings.removeConnection')}
                </button>
              </div>
              {test?.jira?.error && <ErrorBanner error={test.jira.error} />}
              {test?.tempo?.error && <ErrorBanner error={test.tempo.error} />}

              <div className="custom-fields-group">
                <h4>{t('settings.sectionCustomFields')}</h4>
                <p className="hint">{t('settings.customFieldsHint')}</p>
                {fields.map((field) => (
                <div
                  key={field.id}
                  className={`connection-card ${invalidCustomFields.includes(field) ? 'invalid' : ''}`}
                >
                  <div className="field-row">
                    <div className="field">
                      <label>{t('settings.fieldKey')}</label>
                      <input
                        value={field.key}
                        placeholder="_Attribute_"
                        spellCheck={false}
                        onChange={(e) => patchField(field.id, { key: e.target.value.trim() })}
                      />
                    </div>
                    <div className="field">
                      <label>{t('settings.fieldLabel')}</label>
                      <input
                        value={field.label}
                        onChange={(e) => patchField(field.id, { label: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>{t('settings.fieldType')}</label>
                      <select
                        value={field.type}
                        onChange={(e) =>
                          patchField(field.id, { type: e.target.value as CustomFieldConfig['type'] })
                        }
                      >
                        <option value="string">{t('settings.fieldTypeString')}</option>
                        <option value="boolean">{t('settings.fieldTypeBoolean')}</option>
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label>{t('settings.fieldInstruction')}</label>
                    <textarea
                      className="custom-field-instruction"
                      value={field.instruction}
                      placeholder={t('settings.fieldInstructionPlaceholder')}
                      onChange={(e) => patchField(field.id, { instruction: e.target.value })}
                    />
                  </div>
                  <div className="settings-test-row">
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={field.autoFill}
                        onChange={(e) => patchField(field.id, { autoFill: e.target.checked })}
                      />
                      {t('settings.fieldAutoFill')}
                    </label>
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={field.showInCalendar}
                        onChange={(e) =>
                          patchField(field.id, {
                            showInCalendar: e.target.checked,
                            // Sensible default so the marker is visible right away.
                            calendarIcon:
                              e.target.checked && !field.calendarIcon
                                ? CALENDAR_ICONS[0]
                                : field.calendarIcon
                          })
                        }
                      />
                      {t('settings.fieldShowInCalendar')}
                    </label>
                    {field.showInCalendar && (
                      <label className="settings-checkbox" title={t('settings.fieldCalendarIcon')}>
                        {t('settings.fieldCalendarIcon')}
                        <select
                          className="emoji-select"
                          value={field.calendarIcon}
                          onChange={(e) => patchField(field.id, { calendarIcon: e.target.value })}
                        >
                          {/* Keep a legacy manually-typed icon selectable. */}
                          {field.calendarIcon && !CALENDAR_ICONS.includes(field.calendarIcon) && (
                            <option value={field.calendarIcon}>{field.calendarIcon}</option>
                          )}
                          {CALENDAR_ICONS.map((icon) => (
                            <option key={icon} value={icon}>
                              {icon}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <span style={{ flex: 1 }} />
                    <button
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() => removeField(field.id)}
                    >
                      {t('settings.removeFolder')}
                    </button>
                  </div>
                </div>
              ))}
              <div className="settings-test-row">
                <button className="btn btn-sm" onClick={() => addFieldManually(connection.id)}>
                  + {t('settings.addField')}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => importWorkAttributes(connection.id)}
                  disabled={importingConnectionId !== null}
                >
                  {importingConnectionId === connection.id && <span className="spinner" />}
                  {t('settings.importFields')}
                </button>
              </div>
              {attributes && (
                <div className="chip-list" style={{ marginTop: 8 }}>
                  {importable.length === 0 ? (
                    <span className="hint">{t('settings.importFieldsEmpty')}</span>
                  ) : (
                    importable.map((attribute) => (
                      <button
                        key={attribute.key}
                        className="chip"
                        title={`${attribute.key} (${attribute.type})`}
                        onClick={() => addFieldFromAttribute(connection.id, attribute)}
                      >
                        + {attribute.name}
                      </button>
                    ))
                  )}
                </div>
              )}
              </div>
            </div>
          )
        })}

        {importError && <ErrorBanner error={importError} />}

        {orphanedFields.length > 0 && (
          <div className="custom-fields-group">
            <h4>{t('settings.fieldOrphaned')}</h4>
            {orphanedFields.map((field) => (
              <div key={field.id} className="connection-card invalid">
                <div className="settings-test-row">
                  <span>
                    <strong>{field.label || field.key}</strong>{' '}
                    <span className="hint">{field.key}</span>
                  </span>
                  <span style={{ flex: 1 }} />
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => removeField(field.id)}
                  >
                    {t('settings.removeFolder')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {invalidCustomFields.length > 0 && (
          <p className="hint settings-folder-warning">{t('settings.fieldRequired')}</p>
        )}

        <button className="btn" onClick={addConnection}>
          + {t('settings.addConnection')}
        </button>
      </section>

      <section id="settings-section-llm" className="card settings-section">
        <h3>{t('settings.sectionLlm')}</h3>
        <div className="field">
          <label>{t('settings.llmBackend')}</label>
          <select
            value={draft.llm.backend}
            onChange={(e) => patchSection('llm', { backend: e.target.value as LlmBackendId })}
          >
            <option value="claude-cli">{t('settings.backendClaude')}</option>
            <option value="copilot-cli">{t('settings.backendCopilot')}</option>
            <option value="openai-api">{t('settings.backendOpenAi')}</option>
          </select>
        </div>

        {draft.llm.backend === 'claude-cli' && (
          <div className="field-row">
            <div className="field">
              <label>{t('settings.claudeCliPath')}</label>
              <input
                value={draft.llm.claudeCliPath}
                onChange={(e) => patchSection('llm', { claudeCliPath: e.target.value.trim() })}
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label>{t('settings.cliModel')}</label>
              <ModelSelect
                value={draft.llm.claudeModel}
                models={BACKEND_MODELS['claude-cli']}
                allowDefault
                onChange={(model) => patchSection('llm', { claudeModel: model })}
              />
            </div>
          </div>
        )}
        {draft.llm.backend === 'copilot-cli' && (
          <div className="field-row">
            <div className="field">
              <label>{t('settings.copilotCliPath')}</label>
              <input
                value={draft.llm.copilotCliPath}
                onChange={(e) => patchSection('llm', { copilotCliPath: e.target.value.trim() })}
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label>{t('settings.cliModel')}</label>
              <ModelSelect
                value={draft.llm.copilotModel}
                models={BACKEND_MODELS['copilot-cli']}
                allowDefault
                onChange={(model) => patchSection('llm', { copilotModel: model })}
              />
            </div>
          </div>
        )}
        {draft.llm.backend === 'openai-api' && (
          <>
            <div className="field-row">
              <div className="field">
                <label>{t('settings.openAiApiKey')}</label>
                <input
                  type="password"
                  value={draft.llm.openAi.apiKey}
                  onChange={(e) =>
                    patchSection('llm', { openAi: { ...draft.llm.openAi, apiKey: e.target.value.trim() } })
                  }
                />
              </div>
              <div className="field">
                <label>{t('settings.openAiModel')}</label>
                <ModelSelect
                  value={draft.llm.openAi.model}
                  models={BACKEND_MODELS['openai-api']}
                  onChange={(model) =>
                    patchSection('llm', { openAi: { ...draft.llm.openAi, model } })
                  }
                />
              </div>
            </div>
            <div className="field">
              <label>{t('settings.openAiBaseUrl')}</label>
              <input
                value={draft.llm.openAi.baseUrl}
                onChange={(e) =>
                  patchSection('llm', { openAi: { ...draft.llm.openAi, baseUrl: e.target.value.trim() } })
                }
                spellCheck={false}
              />
            </div>
          </>
        )}

        <div className="field">
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={draft.llm.enableThinking}
              onChange={(e) => patchSection('llm', { enableThinking: e.target.checked })}
            />
            {t('settings.enableThinking')}
          </label>
          <span className="hint">{t('settings.enableThinkingHint')}</span>
        </div>

        <div className="field-row">
          <div className="field">
            <label>{t('settings.issueLookbackDays')}</label>
            <input
              type="number"
              min={1}
              max={365}
              step={1}
              value={draft.issuePool.lookbackDays}
              onChange={(e) =>
                patchSection('issuePool', { lookbackDays: Number(e.target.value) || 60 })
              }
            />
          </div>
          <div className="field">
            <label>{t('settings.issueMaxCount')}</label>
            <input
              type="number"
              min={1}
              max={500}
              step={10}
              value={draft.issuePool.maxIssues}
              onChange={(e) => patchSection('issuePool', { maxIssues: Number(e.target.value) || 100 })}
            />
          </div>
        </div>
        <p className="hint" style={{ marginTop: -6 }}>
          {t('settings.issuePoolHint')}
        </p>

        <div className="field">
          <label>{t('settings.additionalInstructions')}</label>
          <textarea
            className="settings-prompt"
            value={draft.llm.additionalInstructions}
            placeholder={t('settings.additionalInstructionsPlaceholder')}
            onChange={(e) => patchSection('llm', { additionalInstructions: e.target.value })}
            spellCheck={false}
          />
          <span className="hint">{t('settings.additionalInstructionsHint')}</span>
        </div>
      </section>

      <section id="settings-section-appearance" className="card settings-section">
        <h3>{t('settings.sectionAppearance')}</h3>
        <div className="field-row">
          <div className="field">
            <label>{t('settings.language')}</label>
            <select
              value={draft.language}
              onChange={(e) => patch({ language: e.target.value as AppConfig['language'] })}
            >
              <option value="pl">Polski</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="field">
            <label>{t('settings.theme')}</label>
            <select value={draft.themeId} onChange={(e) => patch({ themeId: e.target.value })}>
              {THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {t(theme.nameKey)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t('settings.workingHours')}</label>
            <input
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={draft.workingHoursPerDay}
              onChange={(e) => patch({ workingHoursPerDay: Number(e.target.value) || 8 })}
            />
          </div>
          <div className="field">
            <label>{t('settings.workdayStart')}</label>
            <input
              type="time"
              value={draft.workdayStart}
              onChange={(e) => patch({ workdayStart: e.target.value || '09:00' })}
            />
          </div>
        </div>
        <div className="field">
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={draft.showWeekends}
              onChange={(e) => patch({ showWeekends: e.target.checked })}
            />
            {t('settings.showWeekends')}
          </label>
        </div>
      </section>

      <section id="settings-section-updates" className="card settings-section">
        <h3>{t('settings.sectionUpdates')}</h3>
        <div className="field-row">
          <div className="field">
            <label>{t('settings.updateMode')}</label>
            <select
              value={draft.updates.mode}
              onChange={(e) =>
                patchSection('updates', { mode: e.target.value as AppConfig['updates']['mode'] })
              }
            >
              <option value="ask">{t('settings.updateModeAsk')}</option>
              <option value="auto">{t('settings.updateModeAuto')}</option>
              <option value="off">{t('settings.updateModeOff')}</option>
            </select>
          </div>
          <div className="field">
            <label>{t('settings.currentVersion')}</label>
            <input value={update?.currentVersion ?? ''} readOnly spellCheck={false} />
          </div>
        </div>
        <div className="settings-test-row">
          <button className="btn" onClick={checkForUpdates} disabled={checking}>
            {checking && <span className="spinner" />}
            {t('settings.checkForUpdates')}
          </button>
          {updateStatusText() && <span className="hint">{updateStatusText()}</span>}
        </div>
        {update && !update.canAutoUpdate && (
          <p className="hint">{t('settings.updateManualOnly')}</p>
        )}
      </section>

      <div className="settings-save-bar">
        {savedFlash && !dirty && <span className="settings-test-ok">✓ {t('settings.saved')}</span>}
        {saveBlocked && showBlockReason && (
          <span className="settings-save-blocked">{saveBlockedReason}</span>
        )}
        {dirty && (
          <button className="btn btn-ghost" onClick={discard}>
            {t('settings.discardChanges')}
          </button>
        )}
        <button
          className={`btn btn-primary ${saveBlocked ? 'blocked' : ''}`}
          onClick={save}
          disabled={!dirty && !saveBlocked}
          title={saveBlockedReason}
        >
          {t('app.save')}
        </button>
      </div>

      <div className="settings-paths">
        {configPath && <p className="hint">{t('settings.configLocation', { path: configPath })}</p>}
        {logPath && <p className="hint">{t('settings.logLocation', { path: logPath })}</p>}
      </div>
      </div>
    </div>
  )
}
