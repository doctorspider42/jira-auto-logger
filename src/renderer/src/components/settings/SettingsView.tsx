import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AppConfig,
  AppError,
  CustomFieldConfig,
  JiraConnection,
  LlmBackendId,
  TempoWorkAttribute
} from '@shared/domain'
import {
  formatReportFilename,
  validateReportFilenameTemplate
} from '@shared/reportFilename'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { HelpTip } from '@/components/common/HelpTip'
import { Icon, type IconName } from '@/components/common/Icon'
import { UpdateCheckButton } from '@/components/common/UpdateCheckButton'
import { VersionHistoryModal } from '@/components/common/VersionHistoryModal'
import { UPDATE_NOTIFYING_STATUSES, useAppStore } from '@/store/appStore'
import { THEMES } from '@/theme/themes'
import { openExternal } from '@/utils/external'
import { formatHours } from '@/utils/format'
import { ModelSelect } from './ModelSelect'
import { TokenHelp } from './TokenHelp'
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

/** Typed on the Settings screen, reveals the themes flagged `hidden`. */
const THEME_UNLOCK_CODE = 'maasnek'

const JIRA_TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens'
const TEMPO_TOKEN_HELP_URL = 'https://help.tempo.io/timesheets/latest/rest-api-access-tokens'

/** Icons available for the "show in calendar" marker of a custom field. */
const CALENDAR_ICONS = ['⭐', '🔥', '🏠', '💰', '🌙', '🚨', '📞', '✈️', '🎓', '🐛', '🖌️']

/** Edits wait this long for the next keystroke before they are saved. */
const AUTOSAVE_DELAY_MS = 600

type SectionId = 'general' | 'accounts' | 'ai' | 'appearance' | 'automation' | 'reports' | 'about'

/** The sections, each with the icon tile it carries in the list. */
const SECTIONS: Array<{ id: SectionId; labelKey: string; icon: IconName; tile: string }> = [
  { id: 'general', labelKey: 'settings.sectionGeneral', icon: 'sliders', tile: '#a9aeb8' },
  { id: 'accounts', labelKey: 'settings.sectionConnections', icon: 'link', tile: '#9db4ff' },
  { id: 'ai', labelKey: 'settings.sectionLlm', icon: 'sparkle', tile: '#b79bff' },
  { id: 'appearance', labelKey: 'settings.sectionAppearance', icon: 'palette', tile: '#f28cc0' },
  { id: 'automation', labelKey: 'settings.sectionAutomation', icon: 'clock', tile: '#6fd8a0' },
  { id: 'reports', labelKey: 'settings.sectionReports', icon: 'document', tile: '#f0b85a' },
  { id: 'about', labelKey: 'settings.sectionAbout', icon: 'shield', tile: '#5cc8d0' }
]

/** Tiles for the accounts, in order. */
const ACCOUNT_TILES = ['#9db4ff', '#6fd8a0', '#f0b85a', '#f28cc0', '#b79bff', '#5cc8d0']

/** Deep link to the API Integration page of the user's own Tempo instance. */
function tempoTokenUrl(jiraBaseUrl: string): string {
  if (!jiraBaseUrl) return TEMPO_TOKEN_HELP_URL
  const base = jiraBaseUrl.replace(/\/+$/, '')
  return `${base}/plugins/servlet/ac/io.tempo.jira/tempo-app#!/configuration/api-integration`
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

interface ConnectionTest {
  jira?: { name?: string; error?: AppError }
  tempo?: { skipped?: boolean; error?: AppError }
}

type SaveState = 'idle' | 'saving' | 'saved' | 'blocked' | 'failed'

export function SettingsView(): JSX.Element {
  const { t } = useTranslation()
  const saved = useAppStore((s) => s.config)
  const saveConfig = useAppStore((s) => s.saveConfig)
  const update = useAppStore((s) => s.update)
  const [autoLoggerRunning, setAutoLoggerRunning] = useState(false)
  const [autoLoggerResult, setAutoLoggerResult] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const [draft, setDraft] = useState<AppConfig>(() => structuredClone(saved))
  const [tests, setTests] = useState<Record<string, ConnectionTest>>({})
  const [testingId, setTestingId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<AppError | null>(null)
  const [configPath, setConfigPath] = useState('')
  const [logPath, setLogPath] = useState('')

  const [section, setSection] = useState<SectionId>('general')
  const [revealHiddenThemes, setRevealHiddenThemes] = useState(false)
  // Account cards start open when there is just one, or one needs attention.
  const [openAccounts, setOpenAccounts] = useState<Set<string>>(
    () =>
      new Set(
        saved.connections
          .filter((c, _, all) => all.length === 1 || !c.jira.apiToken || !c.tempo.apiToken)
          .map((c) => c.id)
      )
  )
  const [openFields, setOpenFields] = useState<Set<string>>(new Set())

  useEffect(() => {
    void window.api.config.getFilePath().then(setConfigPath)
    void window.api.config.getLogFilePath().then(setLogPath)
  }, [])

  // Type the code anywhere on this screen to add the `hidden` themes to the
  // gallery for the rest of the session. Deliberately not persisted: whoever
  // wants one permanently either keeps it selected or edits config.json.
  useEffect(() => {
    if (revealHiddenThemes) return
    let typed = ''
    const onKeyDown = (e: KeyboardEvent): void => {
      // This screen is mostly text fields - never collect what is being typed
      // into one of them, or a note mentioning the code would trip the unlock.
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key.length !== 1) return
      typed = (typed + e.key.toLowerCase()).slice(-THEME_UNLOCK_CODE.length)
      if (typed === THEME_UNLOCK_CODE) setRevealHiddenThemes(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [revealHiddenThemes])

  const patch = (changes: Partial<AppConfig>): void => setDraft((d) => ({ ...d, ...changes }))
  const patchSection = <K extends keyof AppConfig>(key: K, changes: SectionPatch<K>): void =>
    setDraft((d) => ({ ...d, [key]: { ...(d[key] as object), ...changes } }))

  const patchConnection = (id: string, change: (c: JiraConnection) => JiraConnection): void =>
    setDraft((d) => ({
      ...d,
      connections: d.connections.map((c) => (c.id === id ? change(c) : c))
    }))

  const toggleIn = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

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
    setOpenAccounts((open) => new Set(open).add(connection.id))
  }

  const removeConnection = (id: string): void =>
    setDraft((d) => ({
      ...d,
      connections: d.connections.filter((c) => c.id !== id),
      activeConnectionIds: d.activeConnectionIds.filter((a) => a !== id)
    }))

  const pickReportsFolder = async (): Promise<void> => {
    const path = await window.api.dialog.pickFolder()
    if (path) patchSection('reports', { outputDirectory: path })
  }

  // ---------- Custom fields ----------

  const [workAttributes, setWorkAttributes] = useState<Record<string, TempoWorkAttribute[]>>({})
  const [importingConnectionId, setImportingConnectionId] = useState<string | null>(null)
  const [importError, setImportError] = useState<AppError | null>(null)

  const newField = (connectionId: string, changes: Partial<CustomFieldConfig>): CustomFieldConfig => ({
    id: crypto.randomUUID(),
    connectionId,
    key: '',
    label: '',
    type: 'string',
    autoFill: true,
    instruction: '',
    showInCalendar: false,
    calendarIcon: '',
    ...changes
  })

  const addFieldFromAttribute = (connectionId: string, attribute: TempoWorkAttribute): void =>
    patch({
      customFields: [
        ...draft.customFields,
        newField(connectionId, {
          key: attribute.key,
          label: attribute.name,
          type: attribute.type === 'CHECKBOX' ? 'boolean' : 'string'
        })
      ]
    })

  const addFieldManually = (connectionId: string): void => {
    const field = newField(connectionId, {})
    patch({ customFields: [...draft.customFields, field] })
    setOpenFields((open) => new Set(open).add(field.id))
  }

  const patchField = (id: string, changes: Partial<CustomFieldConfig>): void =>
    patch({ customFields: draft.customFields.map((f) => (f.id === id ? { ...f, ...changes } : f)) })

  const removeField = (id: string): void =>
    patch({ customFields: draft.customFields.filter((f) => f.id !== id) })

  const invalidCustomFields = draft.customFields.filter(
    (f) => !f.key.trim() || !f.label.trim() || !draft.connections.some((c) => c.id === f.connectionId)
  )

  /** Fields whose connection was removed - shown for cleanup. */
  const orphanedFields = draft.customFields.filter(
    (f) => !draft.connections.some((c) => c.id === f.connectionId)
  )

  const reportFilenameError = validateReportFilenameTemplate(draft.reports.filenameTemplate)
  const now = new Date()
  const reportFilenameMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const reportFilenamePreview = reportFilenameError
    ? ''
    : formatReportFilename(draft.reports.filenameTemplate, reportFilenameMonth, draft.reports.defaultLayout)
  const reportFilenameErrorText = reportFilenameError ? t(`reports.filenameError.${reportFilenameError}`) : ''
  const saveBlocked = invalidCustomFields.length > 0 || Boolean(reportFilenameError)
  const saveBlockedReason = invalidCustomFields.length > 0 ? t('settings.fieldRequired') : reportFilenameErrorText

  // ---------- Saving: every change is saved shortly after it is made ----------

  const draftJson = useMemo(() => JSON.stringify(draft), [draft])
  const savedJson = useMemo(() => JSON.stringify(saved), [saved])
  const dirty = draftJson !== savedJson
  /** The config this screen last wrote, to tell its own saves from outside ones. */
  const lastWritten = useRef(savedJson)

  // A change made elsewhere (the Reports screen picking a folder, the tray)
  // flows in while nothing is being edited here.
  useEffect(() => {
    if (savedJson === lastWritten.current) return
    lastWritten.current = savedJson
    setDraft(structuredClone(saved))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedJson])

  useEffect(() => {
    if (!dirty) return
    if (saveBlocked) {
      setSaveState('blocked')
      return
    }
    setSaveState('saving')
    const timer = setTimeout(() => {
      const snapshot = JSON.parse(draftJson) as AppConfig
      lastWritten.current = draftJson
      void saveConfig(snapshot).then((result) => {
        if (result.ok) {
          setSaveState('saved')
          setError(null)
        } else {
          setSaveState('failed')
          setError(result.error)
        }
      })
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJson, saveBlocked])

  /** Saves right away - for actions that read the config from the backend. */
  const saveNow = async (): Promise<boolean> => {
    if (saveBlocked) return false
    lastWritten.current = draftJson
    const result = await saveConfig(draft)
    if (!result.ok) setError(result.error)
    return result.ok
  }

  const testConnection = async (connection: JiraConnection): Promise<void> => {
    setTests((all) => ({ ...all, [connection.id]: {} }))
    setTestingId(connection.id)
    await saveNow()
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

  const importWorkAttributes = async (connectionId: string): Promise<void> => {
    setImportingConnectionId(connectionId)
    setImportError(null)
    await saveNow()
    const result = await window.api.tempo.getWorkAttributes(connectionId)
    setImportingConnectionId(null)
    if (result.ok) {
      setWorkAttributes((all) => ({ ...all, [connectionId]: result.value }))
    } else {
      setImportError(result.error)
    }
  }

  const checkForUpdates = async (): Promise<void> => {
    await saveNow()
    await window.api.updates.check()
  }

  const runAutoLoggerNow = async (): Promise<void> => {
    setAutoLoggerRunning(true)
    setAutoLoggerResult('')
    setError(null)
    if (!(await saveNow())) {
      setAutoLoggerRunning(false)
      return
    }
    const result = await window.api.autoLogger.runNow()
    setAutoLoggerRunning(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (result.value.kind === 'completed') {
      setAutoLoggerResult(
        result.value.createdCount > 0
          ? t('settings.autoLoggerRunCompleted', {
              count: result.value.createdCount,
              hours: formatHours(result.value.totalSeconds)
            })
          : t('settings.autoLoggerRunNoChanges')
      )
    }
  }

  // ---------- Small building blocks ----------

  const toggleRow = (label: string, checked: boolean, onChange: (value: boolean) => void, hint?: string): JSX.Element => (
    <label className="settings-row">
      <span className="settings-row-label">
        {label}
        {hint && <HelpTip label={label}>{hint}</HelpTip>}
      </span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </label>
  )

  const accountStatus = (connection: JiraConnection): { kind: 'ok' | 'warn' | 'error'; text: string } => {
    const test = tests[connection.id]
    if (test?.jira?.error || test?.tempo?.error) return { kind: 'error', text: t('settings.statusFailed') }
    if (!connection.jira.baseUrl || !connection.jira.email || !connection.jira.apiToken)
      return { kind: 'warn', text: t('settings.statusIncomplete') }
    if (!connection.tempo.apiToken) return { kind: 'warn', text: t('settings.statusNoTempo') }
    return { kind: 'ok', text: test?.jira ? t('settings.statusConnected') : t('settings.statusReady') }
  }

  const accountsNeedAttention = draft.connections.some((c) => accountStatus(c).kind !== 'ok')
  const updateAvailable = !!update?.status && UPDATE_NOTIFYING_STATUSES.has(update.status)

  // ---------- Sections ----------

  const renderField = (field: CustomFieldConfig): JSX.Element => {
    const invalid = invalidCustomFields.includes(field)
    const open = openFields.has(field.id) || invalid
    return (
      <div key={field.id} className={`settings-field ${invalid ? 'invalid' : ''}`}>
        <div className="settings-field-row">
          <span className="settings-field-name">
            {field.calendarIcon && field.showInCalendar && <span aria-hidden>{field.calendarIcon}</span>}
            <strong>{field.label || field.key || t('settings.fieldUnnamed')}</strong>
            <span className="muted">
              {field.type === 'boolean' ? t('settings.fieldTypeBoolean') : t('settings.fieldTypeString')}
            </span>
          </span>
          <label className="switch">
            <input type="checkbox" checked={field.autoFill} onChange={(e) => patchField(field.id, { autoFill: e.target.checked })} />
            {t('settings.fieldAutoFillShort')}
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={field.showInCalendar}
              onChange={(e) =>
                patchField(field.id, {
                  showInCalendar: e.target.checked,
                  // A default so the marker is visible right away.
                  calendarIcon: e.target.checked && !field.calendarIcon ? CALENDAR_ICONS[0] : field.calendarIcon
                })
              }
            />
            {t('settings.fieldShowInCalendar')}
          </label>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            aria-expanded={open}
            aria-label={t('settings.fieldEdit')}
            title={t('settings.fieldEdit')}
            onClick={() => setOpenFields((all) => toggleIn(all, field.id))}
          >
            <Icon name="more" />
          </button>
        </div>
        {open && (
          <div className="settings-field-editor">
            <div className="settings-grid">
              <label className="field">
                <span>{t('settings.fieldLabel')}</span>
                <input
                  className={!field.label.trim() ? 'input-error' : undefined}
                  value={field.label}
                  onChange={(e) => patchField(field.id, { label: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{t('settings.fieldKey')}</span>
                <input
                  className={`mono ${!field.key.trim() ? 'input-error' : ''}`}
                  value={field.key}
                  placeholder="_Attribute_"
                  spellCheck={false}
                  onChange={(e) => patchField(field.id, { key: e.target.value.trim() })}
                />
              </label>
              <label className="field">
                <span>{t('settings.fieldType')}</span>
                <select
                  value={field.type}
                  onChange={(e) => patchField(field.id, { type: e.target.value as CustomFieldConfig['type'] })}
                >
                  <option value="string">{t('settings.fieldTypeString')}</option>
                  <option value="boolean">{t('settings.fieldTypeBoolean')}</option>
                </select>
              </label>
              {field.showInCalendar && (
                <label className="field">
                  <span>{t('settings.fieldCalendarIcon')}</span>
                  <select value={field.calendarIcon} onChange={(e) => patchField(field.id, { calendarIcon: e.target.value })}>
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
            </div>
            <label className="field">
              <span>{t('settings.fieldInstruction')}</span>
              <textarea
                rows={2}
                value={field.instruction}
                placeholder={t('settings.fieldInstructionPlaceholder')}
                onChange={(e) => patchField(field.id, { instruction: e.target.value })}
              />
            </label>
            <button className="link link-danger" onClick={() => removeField(field.id)}>
              {t('settings.fieldRemove')}
            </button>
          </div>
        )}
      </div>
    )
  }

  const renderAccount = (connection: JiraConnection, index: number): JSX.Element => {
    const open = openAccounts.has(connection.id)
    const status = accountStatus(connection)
    const test = tests[connection.id]
    const fields = draft.customFields.filter((f) => f.connectionId === connection.id)
    const attributes = workAttributes[connection.id]
    const importable = (attributes ?? []).filter((a) => !fields.some((f) => f.key === a.key))
    const name = connection.name || hostOf(connection.jira.baseUrl) || t('settings.newAccount')
    return (
      <div key={connection.id} className="settings-card settings-account">
        <button
          className="settings-account-head"
          aria-expanded={open}
          onClick={() => setOpenAccounts((all) => toggleIn(all, connection.id))}
        >
          <span className="settings-tile" style={{ background: ACCOUNT_TILES[index % ACCOUNT_TILES.length] }} aria-hidden>
            {name.charAt(0).toUpperCase()}
          </span>
          <span className="settings-account-name">
            <strong>{name}</strong>
            <span className="mono muted">{hostOf(connection.jira.baseUrl) || '—'}</span>
          </span>
          <span className={`settings-pill ${status.kind}`}>{status.text}</span>
          <span className={`settings-chevron ${open ? 'open' : ''}`} aria-hidden>
            <Icon name="chevronDown" />
          </span>
        </button>

        {open && (
          <div className="settings-account-body">
            <div className="settings-grid">
              <label className="field">
                <span>{t('settings.connectionName')}</span>
                <input
                  value={connection.name}
                  placeholder={t('settings.connectionNamePlaceholder')}
                  onChange={(e) => patchConnection(connection.id, (c) => ({ ...c, name: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>{t('settings.jiraBaseUrl')}</span>
                <input
                  className="mono"
                  value={connection.jira.baseUrl}
                  placeholder="https://company.atlassian.net"
                  spellCheck={false}
                  onChange={(e) =>
                    patchConnection(connection.id, (c) => ({ ...c, jira: { ...c.jira, baseUrl: e.target.value.trim() } }))
                  }
                />
              </label>
              <label className="field settings-grid-wide">
                <span>{t('settings.jiraEmail')}</span>
                <input
                  value={connection.jira.email}
                  spellCheck={false}
                  onChange={(e) =>
                    patchConnection(connection.id, (c) => ({ ...c, jira: { ...c.jira, email: e.target.value.trim() } }))
                  }
                />
              </label>
              <div className="field">
                <span className="settings-label-row">
                  {t('settings.jiraApiToken')}
                  <HelpTip label={t('settings.jiraTokenHelp.title')}>
                    <TokenHelp kind="jira" />
                  </HelpTip>
                  <button className="link" onClick={() => openExternal(JIRA_TOKEN_URL)}>
                    {t('settings.getToken')} ↗
                  </button>
                </span>
                <input
                  type="password"
                  aria-label={t('settings.jiraApiToken')}
                  value={connection.jira.apiToken}
                  onChange={(e) =>
                    patchConnection(connection.id, (c) => ({ ...c, jira: { ...c.jira, apiToken: e.target.value.trim() } }))
                  }
                />
              </div>
              <div className="field">
                <span className="settings-label-row">
                  {t('settings.tempoApiToken')}
                  <HelpTip label={t('settings.tempoTokenHelp.title')} align="end">
                    <TokenHelp kind="tempo" />
                  </HelpTip>
                  <button className="link" onClick={() => openExternal(tempoTokenUrl(connection.jira.baseUrl))}>
                    {t('settings.getToken')} ↗
                  </button>
                </span>
                <input
                  type="password"
                  aria-label={t('settings.tempoApiToken')}
                  className={connection.tempo.apiToken ? undefined : 'input-warning'}
                  value={connection.tempo.apiToken}
                  placeholder={t('settings.tempoTokenPlaceholder')}
                  onChange={(e) => patchConnection(connection.id, (c) => ({ ...c, tempo: { apiToken: e.target.value.trim() } }))}
                />
              </div>
            </div>

            <div className="settings-actions">
              <button className="btn" onClick={() => testConnection(connection)} disabled={testingId !== null}>
                {testingId === connection.id && <span className="spinner" />}
                {t('settings.testConnection')}
              </button>
              {test?.jira && !test.jira.error && (
                <span className="settings-ok">
                  ✓ {t('settings.connectionOk', { name: test.jira.name })}
                  {test.tempo && !test.tempo.error && !test.tempo.skipped && ` · ${t('settings.tempoOk')}`}
                </span>
              )}
              {test?.tempo?.skipped && <span className="settings-warn">{t('settings.tempoSkipped')}</span>}
              <span className="spacer" />
              <button className="btn btn-ghost btn-danger" onClick={() => removeConnection(connection.id)}>
                {t('settings.removeConnection')}
              </button>
            </div>
            {test?.jira?.error && <ErrorBanner error={test.jira.error} />}
            {test?.tempo?.error && <ErrorBanner error={test.tempo.error} />}

            <div className="settings-fields">
              <div className="settings-fields-head">
                <h3>
                  {t('settings.sectionCustomFields')}
                  <HelpTip label={t('settings.sectionCustomFields')}>{t('settings.customFieldsHint')}</HelpTip>
                </h3>
                <span className="spacer" />
                <button className="link" onClick={() => importWorkAttributes(connection.id)} disabled={importingConnectionId !== null}>
                  {importingConnectionId === connection.id && <span className="spinner" />}
                  {t('settings.importFields')}
                </button>
                <button className="link" onClick={() => addFieldManually(connection.id)}>
                  + {t('settings.addField')}
                </button>
              </div>
              {fields.length === 0 && !attributes && <p className="muted settings-empty">{t('settings.fieldsEmpty')}</p>}
              {fields.map(renderField)}
              {attributes && (
                <div className="chip-list">
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
        )}
      </div>
    )
  }

  const renderAccounts = (): JSX.Element => (
    <>
      <header className="settings-head">
        <h2>
          {t('settings.sectionConnections')}
          <HelpTip label={t('settings.sectionConnections')}>{t('settings.connectionsHint')}</HelpTip>
        </h2>
      </header>
      {draft.connections.map(renderAccount)}
      {importError && <ErrorBanner error={importError} />}
      {orphanedFields.length > 0 && (
        <div className="settings-card settings-card-pad">
          <h3>{t('settings.fieldOrphaned')}</h3>
          {orphanedFields.map((field) => (
            <div key={field.id} className="settings-actions">
              <span>
                <strong>{field.label || field.key}</strong> <span className="muted mono">{field.key}</span>
              </span>
              <span className="spacer" />
              <button className="link link-danger" onClick={() => removeField(field.id)}>
                {t('settings.fieldRemove')}
              </button>
            </div>
          ))}
        </div>
      )}
      <button className="settings-add" onClick={addConnection}>
        <Icon name="plus" />
        {t('settings.addConnection')}
      </button>
    </>
  )

  const providers: Array<{ id: LlmBackendId; name: string; note: string }> = [
    { id: 'claude-cli', name: t('settings.backendClaude'), note: t('settings.backendClaudeNote') },
    { id: 'copilot-cli', name: t('settings.backendCopilot'), note: t('settings.backendCopilotNote') },
    { id: 'openai-api', name: t('settings.backendOpenAi'), note: t('settings.backendOpenAiNote') }
  ]

  const renderAi = (): JSX.Element => {
    const backend = draft.llm.backend
    const cli = backend !== 'openai-api'
    return (
      <>
        <header className="settings-head">
          <h2>{t('settings.sectionLlm')}</h2>
          <p className="muted">{t('settings.llmLead')}</p>
        </header>
        <div className="settings-tiles" role="radiogroup" aria-label={t('settings.llmBackend')}>
          {providers.map((provider) => (
            <button
              key={provider.id}
              role="radio"
              aria-checked={backend === provider.id}
              className={`settings-choice ${backend === provider.id ? 'selected' : ''}`}
              onClick={() => patchSection('llm', { backend: provider.id })}
            >
              <span className="settings-choice-title">
                {provider.name}
                <span className="settings-radio" aria-hidden />
              </span>
              <span className="muted">{provider.note}</span>
            </button>
          ))}
        </div>

        <div className="settings-card settings-card-pad">
          {cli ? (
            <>
              <div className="settings-grid">
                <div className="field">
                  <span>{t('settings.cliModel')}</span>
                  <ModelSelect
                    value={backend === 'claude-cli' ? draft.llm.claudeModel : draft.llm.copilotModel}
                    models={BACKEND_MODELS[backend]}
                    allowDefault
                    onChange={(model) =>
                      patchSection('llm', backend === 'claude-cli' ? { claudeModel: model } : { copilotModel: model })
                    }
                  />
                </div>
                <label className="field">
                  <span className="settings-label-row">
                    {backend === 'claude-cli' ? t('settings.claudeCliPath') : t('settings.copilotCliPath')}
                    <HelpTip label={t('settings.cliPathHelpLabel')}>{t('settings.cliPathHint')}</HelpTip>
                  </span>
                  <input
                    className="mono"
                    value={backend === 'claude-cli' ? draft.llm.claudeCliPath : draft.llm.copilotCliPath}
                    spellCheck={false}
                    onChange={(e) =>
                      patchSection(
                        'llm',
                        backend === 'claude-cli'
                          ? { claudeCliPath: e.target.value.trim() }
                          : { copilotCliPath: e.target.value.trim() }
                      )
                    }
                  />
                </label>
              </div>
              <div className="settings-actions">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={draft.llm.enableThinking}
                    onChange={(e) => patchSection('llm', { enableThinking: e.target.checked })}
                  />
                  {t('settings.enableThinking')}
                </label>
                <HelpTip label={t('settings.enableThinking')}>{t('settings.enableThinkingHint')}</HelpTip>
                <span className="spacer" />
                {backend === 'claude-cli' && (
                  <button className="link" onClick={() => void window.api.llm.startClaudeLogin()}>
                    {t('settings.claudeSignIn')}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <label className="field">
                <span className="settings-label-row">
                  {t('settings.openAiApiKey')}
                  <button className="link" onClick={() => openExternal('https://platform.openai.com/api-keys')}>
                    {t('settings.getKey')} ↗
                  </button>
                </span>
                <input
                  type="password"
                  value={draft.llm.openAi.apiKey}
                  onChange={(e) => patchSection('llm', { openAi: { ...draft.llm.openAi, apiKey: e.target.value.trim() } })}
                />
              </label>
              <div className="settings-grid">
                <div className="field">
                  <span>{t('settings.openAiModel')}</span>
                  <ModelSelect
                    value={draft.llm.openAi.model}
                    models={BACKEND_MODELS['openai-api']}
                    onChange={(model) => patchSection('llm', { openAi: { ...draft.llm.openAi, model } })}
                  />
                </div>
                <label className="field">
                  <span className="settings-label-row">
                    {t('settings.openAiBaseUrl')}
                    <HelpTip label={t('settings.openAiBaseUrl')} align="end">
                      {t('settings.openAiBaseUrlHint')}
                    </HelpTip>
                  </span>
                  <input
                    className="mono"
                    value={draft.llm.openAi.baseUrl}
                    spellCheck={false}
                    onChange={(e) =>
                      patchSection('llm', { openAi: { ...draft.llm.openAi, baseUrl: e.target.value.trim() } })
                    }
                  />
                </label>
              </div>
            </>
          )}
        </div>

        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row-label">
              {t('settings.issuePoolTitle')}
              <HelpTip label={t('settings.issuePoolTitle')}>{t('settings.issuePoolHint')}</HelpTip>
            </span>
            <span className="settings-sentence">
              {t('settings.issuePoolUpTo')}
              <input
                type="number"
                min={1}
                max={500}
                step={10}
                aria-label={t('settings.issueMaxCount')}
                value={draft.issuePool.maxIssues}
                onChange={(e) => patchSection('issuePool', { maxIssues: Number(e.target.value) || 100 })}
              />
              {t('settings.issuePoolUpdated')}
              <input
                type="number"
                min={1}
                max={365}
                aria-label={t('settings.issueLookbackDays')}
                value={draft.issuePool.lookbackDays}
                onChange={(e) => patchSection('issuePool', { lookbackDays: Number(e.target.value) || 60 })}
              />
              {t('settings.issuePoolDays')}
            </span>
          </div>
          <label className="settings-row settings-row-column">
            <span className="settings-row-label">
              {t('settings.additionalInstructions')}
              <HelpTip label={t('settings.additionalInstructions')}>{t('settings.additionalInstructionsHint')}</HelpTip>
            </span>
            <textarea
              rows={3}
              value={draft.llm.additionalInstructions}
              placeholder={t('settings.additionalInstructionsPlaceholder')}
              spellCheck={false}
              onChange={(e) => patchSection('llm', { additionalInstructions: e.target.value })}
            />
          </label>
        </div>
      </>
    )
  }

  const renderAppearance = (): JSX.Element => (
    <>
      <header className="settings-head">
        <h2>{t('settings.sectionAppearance')}</h2>
      </header>
      <div className="settings-themes" role="radiogroup" aria-label={t('settings.theme')}>
        {THEMES.filter((theme) => !theme.hidden || revealHiddenThemes || theme.id === draft.themeId).map((theme) => {
          const tokens = theme.tokens
          return (
            <button
              key={theme.id}
              role="radio"
              aria-checked={draft.themeId === theme.id}
              className={`settings-theme ${draft.themeId === theme.id ? 'selected' : ''}`}
              onClick={() => patch({ themeId: theme.id })}
            >
              <span className="settings-theme-preview" style={{ background: tokens.ground }} aria-hidden>
                <span style={{ background: tokens.surface }} />
                <span className="settings-theme-body">
                  <span style={{ background: tokens.ink }} />
                  <span style={{ background: tokens.surface }} />
                </span>
                <span className="settings-theme-accent" style={{ background: tokens.accent }} />
              </span>
              <span className="settings-theme-name">{t(theme.nameKey)}</span>
            </button>
          )
        })}
      </div>

    </>
  )

  const renderGeneral = (): JSX.Element => (
    <>
      <header className="settings-head">
        <h2>{t('settings.sectionGeneral')}</h2>
      </header>
      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">{t('settings.language')}</span>
          <div className="segmented" role="group" aria-label={t('settings.language')}>
            {(['pl', 'en'] as const).map((language) => (
              <button
                key={language}
                className={draft.language === language ? 'active' : ''}
                onClick={() => patch({ language })}
              >
                {language === 'pl' ? 'Polski' : 'English'}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">
            {t('settings.workingDay')}
            <span className="muted settings-row-note">{t('settings.workingDayNote')}</span>
          </span>
          <span className="settings-sentence">
            <input
              type="number"
              min={1}
              max={24}
              step={0.5}
              aria-label={t('settings.workingHours')}
              value={draft.workingHoursPerDay}
              onChange={(e) => patch({ workingHoursPerDay: Number(e.target.value) || 8 })}
            />
            {t('settings.workingDayHours')}
            <input
              type="time"
              aria-label={t('settings.workdayStart')}
              value={draft.workdayStart}
              onChange={(e) => patch({ workdayStart: e.target.value || '09:00' })}
            />
          </span>
        </div>
        {toggleRow(t('settings.showWeekends'), draft.showWeekends, (value) => patch({ showWeekends: value }))}
      </div>
    </>
  )

  const [autoLoggerHour = '17', autoLoggerMinute = '00'] = draft.autoLogger.runAt.split(':')
  const modes: Array<{ id: AppConfig['autoLogger']['mode']; title: string; note: string }> = [
    { id: 'off', title: t('settings.autoLoggerOff'), note: t('settings.autoLoggerOffNote') },
    { id: 'notify', title: t('settings.autoLoggerNotify'), note: t('settings.autoLoggerNotifyNote') },
    { id: 'confirm', title: t('settings.autoLoggerConfirm'), note: t('settings.autoLoggerConfirmNote') },
    { id: 'auto', title: t('settings.autoLoggerAuto'), note: t('settings.autoLoggerAutoNote') }
  ]

  const renderAutomation = (): JSX.Element => (
    <>
      <header className="settings-head">
        <h2>{t('settings.sectionAutomation')}</h2>
      </header>
      <div className="settings-card settings-card-pad">
        <p className="settings-sentence settings-sentence-lead">
          {t('settings.autoLoggerEvery')}
          <span className="settings-time-24h">
            <select
              value={autoLoggerHour}
              aria-label={t('settings.autoLoggerHour')}
              onChange={(e) => patchSection('autoLogger', { runAt: `${e.target.value}:${autoLoggerMinute}` })}
            >
              {Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')).map((hour) => (
                <option key={hour} value={hour}>
                  {hour}
                </option>
              ))}
            </select>
            <span aria-hidden>:</span>
            <select
              value={autoLoggerMinute}
              aria-label={t('settings.autoLoggerMinute')}
              onChange={(e) => patchSection('autoLogger', { runAt: `${autoLoggerHour}:${e.target.value}` })}
            >
              {Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))
                .concat(Number(autoLoggerMinute) % 5 ? [autoLoggerMinute] : [])
                .sort()
                .map((minute) => (
                  <option key={minute} value={minute}>
                    {minute}
                  </option>
                ))}
            </select>
          </span>
          {t('settings.autoLoggerTheApp')}
        </p>
        <div className="settings-modes" role="radiogroup" aria-label={t('settings.autoLoggerMode')}>
          {modes.map((mode) => (
            <button
              key={mode.id}
              role="radio"
              aria-checked={draft.autoLogger.mode === mode.id}
              className={`settings-choice settings-mode ${draft.autoLogger.mode === mode.id ? 'selected' : ''}`}
              onClick={() => patchSection('autoLogger', { mode: mode.id })}
            >
              <span className="settings-radio" aria-hidden />
              <span className="settings-mode-text">
                <strong>{mode.title}</strong>
                <span className="muted">{mode.note}</span>
              </span>
            </button>
          ))}
        </div>
        {(draft.autoLogger.mode === 'confirm' || draft.autoLogger.mode === 'auto') &&
          draft.lastUsed.selections.length === 0 && (
            <p className="settings-warn">{t('settings.autoLoggerRecentMissing')}</p>
          )}
        <div className="settings-actions settings-actions-top">
          <span className="muted">{t('settings.autoLoggerScheduleShort')}</span>
          <span className="spacer" />
          {autoLoggerResult && <span className="settings-ok">{autoLoggerResult}</span>}
          <button className="btn" onClick={runAutoLoggerNow} disabled={draft.autoLogger.mode === 'off' || autoLoggerRunning}>
            {autoLoggerRunning && <span className="spinner" />}
            {autoLoggerRunning ? t('settings.autoLoggerRunning') : t('settings.autoLoggerRunNow')}
          </button>
        </div>
      </div>
      <div className="settings-card">
        {toggleRow(t('settings.launchAtLogin'), draft.autoLogger.launchAtLogin, (value) =>
          patchSection('autoLogger', { launchAtLogin: value })
        )}
        {toggleRow(
          t('settings.minimizeToTray'),
          draft.autoLogger.minimizeToTray,
          (value) => patchSection('autoLogger', { minimizeToTray: value }),
          t('settings.minimizeToTrayHint')
        )}
      </div>
    </>
  )

  const renderReports = (): JSX.Element => (
    <>
      <header className="settings-head">
        <h2>{t('settings.sectionReports')}</h2>
      </header>
      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">{t('settings.reportOutputDirectory')}</span>
          <span className="mono muted settings-path">{draft.reports.outputDirectory || t('settings.reportOutputDefault')}</span>
          <button className="btn btn-sm" onClick={pickReportsFolder}>
            {t('settings.chooseFolder')}
          </button>
          {draft.reports.outputDirectory && (
            <button className="link" onClick={() => patchSection('reports', { outputDirectory: '' })}>
              {t('settings.useDefaultFolder')}
            </button>
          )}
        </div>
        <label className={`settings-row settings-row-column ${reportFilenameError ? 'invalid' : ''}`}>
          <span className="settings-row-label">
            {t('reports.filenameTemplate')}
            <HelpTip label={t('reports.filenameTemplate')}>
              {t('reports.filenameTokens')} <code>{'{MM}'}</code> <code>{'{YYYY}'}</code> <code>{'{YYYY-MM}'}</code>{' '}
              <code>{'{layout}'}</code>
            </HelpTip>
          </span>
          <input
            className={`mono ${reportFilenameError ? 'input-error' : ''}`}
            value={draft.reports.filenameTemplate}
            placeholder="{MM}.{YYYY}.pdf"
            spellCheck={false}
            aria-invalid={reportFilenameError ? 'true' : 'false'}
            onChange={(e) => patchSection('reports', { filenameTemplate: e.target.value })}
          />
          {reportFilenameErrorText ? (
            <span className="settings-error">{reportFilenameErrorText}</span>
          ) : (
            <span className="muted settings-row-note">
              {t('settings.forExample')} <span className="mono">{reportFilenamePreview}</span>
            </span>
          )}
        </label>
        <div className="settings-row">
          <span className="settings-row-label">{t('settings.reportDefaultLayout')}</span>
          <div className="segmented" role="group" aria-label={t('settings.reportDefaultLayout')}>
            {(['summary', 'detailed'] as const).map((layout) => (
              <button
                key={layout}
                className={draft.reports.defaultLayout === layout ? 'active' : ''}
                onClick={() => patchSection('reports', { defaultLayout: layout })}
              >
                {t(layout === 'summary' ? 'reports.layoutSummary' : 'reports.layoutDetailed')}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">
            {t('settings.reportReminder')}
            <span className="muted settings-row-note">{t('settings.reportReminderNote')}</span>
          </span>
          <select
            value={draft.reports.reminderOffsetDays === null ? 'off' : String(draft.reports.reminderOffsetDays)}
            onChange={(e) =>
              patchSection('reports', { reminderOffsetDays: e.target.value === 'off' ? null : Number(e.target.value) })
            }
          >
            <option value="off">{t('settings.reportReminderOff')}</option>
            {Array.from({ length: 15 }, (_, index) => index - 7).map((offset) => (
              <option key={offset} value={offset}>
                {offset < 0
                  ? t('settings.reportReminderBefore', { count: Math.abs(offset) })
                  : offset > 0
                    ? t('settings.reportReminderAfter', { count: offset })
                    : t('settings.reportReminderMonthEnd')}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  )

  const renderAbout = (): JSX.Element => (
    <>
      <header className="settings-head">
        <h2>{t('settings.sectionAbout')}</h2>
      </header>
      <div className={`settings-card settings-card-pad settings-version ${updateAvailable ? 'available' : ''}`}>
        <span className="settings-version-text">
          <strong>
            {updateAvailable
              ? t('settings.versionReady', { version: update?.availableVersion })
              : t('settings.versionCurrent', { version: update?.currentVersion ?? '' })}
          </strong>
          {updateAvailable && (
            <span className="muted">{t('settings.versionYouHave', { version: update?.currentVersion ?? '' })}</span>
          )}
        </span>
        <UpdateCheckButton onCheck={checkForUpdates} />
      </div>
      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">{t('settings.updateMode')}</span>
          <div className="segmented" role="group" aria-label={t('settings.updateMode')}>
            {(['auto', 'ask', 'off'] as const).map((mode) => (
              <button
                key={mode}
                className={draft.updates.mode === mode ? 'active' : ''}
                onClick={() => patchSection('updates', { mode })}
              >
                {t(mode === 'auto' ? 'settings.updateModeAuto' : mode === 'ask' ? 'settings.updateModeAsk' : 'settings.updateModeOff')}
              </button>
            ))}
          </div>
        </div>
        {update && !update.canAutoUpdate && <p className="muted settings-row">{t('settings.updateManualOnly')}</p>}
        {toggleRow(
          t('settings.telemetryEnabled'),
          draft.telemetry.enabled,
          (value) => patchSection('telemetry', { enabled: value }),
          t('settings.telemetryHint')
        )}
        <div className="settings-row settings-links">
          {configPath && (
            <button className="link" onClick={() => window.api.reports.reveal(configPath)} title={configPath}>
              {t('settings.openConfigFile')}
            </button>
          )}
          {logPath && (
            <button className="link" onClick={() => window.api.reports.reveal(logPath)} title={logPath}>
              {t('settings.openLogFile')}
            </button>
          )}
          <button className="link" onClick={() => setShowHistory(true)}>
            {t('settings.versionHistory')}
          </button>
        </div>
      </div>
      {showHistory && <VersionHistoryModal onClose={() => setShowHistory(false)} />}
    </>
  )

  const statusText =
    saveState === 'blocked'
      ? saveBlockedReason
      : saveState === 'saving'
        ? t('settings.saving')
        : saveState === 'failed'
          ? t('settings.saveFailed')
          : t('settings.autosaved')

  return (
    <div className="master-detail settings-screen">
      <nav className="md-list settings-nav" aria-label={t('settings.title')}>
        <div className="md-list-head">
          <h1 className="page-title">{t('settings.title')}</h1>
        </div>
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            className={`md-item settings-nav-item ${section === item.id ? 'active' : ''}`}
            aria-current={section === item.id ? 'page' : undefined}
            onClick={() => setSection(item.id)}
          >
            <span className="settings-tile settings-tile-sm" style={{ background: item.tile }} aria-hidden>
              <Icon name={item.icon} size={16} />
            </span>
            <span className="settings-nav-label">{t(item.labelKey)}</span>
            {item.id === 'accounts' && accountsNeedAttention && <span className="dot dot-warning" />}
            {item.id === 'about' && updateAvailable && (
              <span className="dot settings-nav-update" title={update?.availableVersion} />
            )}
          </button>
        ))}
        <p className={`settings-save-status ${saveState}`} role="status">
          {saveState === 'blocked' || saveState === 'failed' ? (
            <span className="dot dot-danger" />
          ) : saveState === 'saving' ? (
            <span className="spinner" />
          ) : (
            <Icon name="check" size={14} />
          )}
          {statusText}
        </p>
      </nav>

      <main className="md-detail settings-detail">
        <div className="settings-content">
          {error && <ErrorBanner error={error} />}
          {section === 'general' && renderGeneral()}
          {section === 'accounts' && renderAccounts()}
          {section === 'ai' && renderAi()}
          {section === 'appearance' && renderAppearance()}
          {section === 'automation' && renderAutomation()}
          {section === 'reports' && renderReports()}
          {section === 'about' && renderAbout()}
        </div>
      </main>
    </div>
  )
}
