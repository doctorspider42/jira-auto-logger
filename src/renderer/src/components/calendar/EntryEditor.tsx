import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppError, CustomFieldConfig } from '@shared/domain'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { Modal } from '@/components/common/Modal'
import { IssueAutocomplete } from '@/components/wizard/IssueAutocomplete'
import type { CalendarEntry } from './useCalendar'

interface EntryEditorProps {
  entry: CalendarEntry
  jiraBaseUrl: string
  /** Custom fields configured for the entry's connection. */
  customFields: CustomFieldConfig[]
  /** Standing LLM instruction of the matched project; used when regenerating. */
  instruction: string
  onClose(): void
  /** Called after a successful save or delete so the calendar can refresh. */
  onSaved(): void
}

/** Editable copy of a persisted worklog, mirroring the wizard's fields. */
interface Draft {
  issueKey: string
  issueSummary: string
  issueTypeName: string
  issueIsSubtask: boolean
  date: string
  hours: number
  description: string
  customFields: Record<string, string | boolean>
}

/** "ABC-123" -> "ABC"; scopes the issue picker to the entry's project. */
const projectKeyOf = (issueKey: string): string => {
  const dash = issueKey.lastIndexOf('-')
  return dash > 0 ? issueKey.slice(0, dash) : ''
}

/**
 * Edit or delete one existing Tempo worklog. Opened by clicking a calendar
 * entry; offers the same fields as adding an entry (issue, date, hours,
 * description, custom fields) and writes the change straight to Tempo.
 */
export function EntryEditor({
  entry,
  jiraBaseUrl,
  customFields,
  instruction,
  onClose,
  onSaved
}: EntryEditorProps): JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Draft>(() => ({
    issueKey: entry.issueKey,
    issueSummary: entry.issueSummary,
    issueTypeName: '',
    issueIsSubtask: false,
    date: entry.startDate,
    hours: entry.timeSpentSeconds / 3600,
    description: entry.description,
    customFields: Object.fromEntries(entry.attributes.map((a) => [a.key, a.value]))
  }))
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [hint, setHint] = useState('')
  const [regenerating, setRegenerating] = useState(false)

  const patch = (changes: Partial<Draft>): void => setDraft((d) => ({ ...d, ...changes }))

  const regenerate = async (): Promise<void> => {
    setRegenerating(true)
    setError(null)
    // No commits are fetched for a past entry; the model rewrites from the
    // current description, the hint and the project's standing instruction.
    const result = await window.api.llm.regenerateDescription({
      suggestion: {
        id: `edit-${entry.tempoWorklogId}`,
        date: draft.date,
        projectKey: projectKeyOf(draft.issueKey),
        issueKey: draft.issueKey,
        issueSummary: draft.issueSummary,
        issueTypeName: draft.issueTypeName,
        issueIsSubtask: draft.issueIsSubtask,
        description: draft.description,
        hours: draft.hours,
        customFields: draft.customFields
      },
      hint,
      freeText: instruction,
      commits: []
    })
    setRegenerating(false)
    if (result.ok) {
      patch({ description: result.value })
      setRegenerateOpen(false)
      setHint('')
    } else {
      setError(result.error)
    }
  }

  const save = async (): Promise<void> => {
    if (!draft.issueKey.trim()) {
      setError({ code: 'CONFIG_INVALID', message: t('wizard.missingIssue') })
      return
    }
    setBusy(true)
    setError(null)
    const result = await window.api.tempo.updateWorklog(entry.connectionId, entry.tempoWorklogId, {
      issueKey: draft.issueKey.trim().toUpperCase(),
      description: draft.description.trim(),
      timeSpentSeconds: Math.round(draft.hours * 3600),
      startDate: draft.date,
      // Booleans always go out; empty strings would clear nothing, so skip them.
      attributes: customFields
        .map((f) => ({
          key: f.key,
          value: draft.customFields[f.key] ?? (f.type === 'boolean' ? false : '')
        }))
        .filter((a) => typeof a.value === 'boolean' || a.value !== '')
    })
    setBusy(false)
    if (result.ok) onSaved()
    else setError(result.error)
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await window.api.tempo.deleteWorklog(entry.connectionId, entry.tempoWorklogId)
    setBusy(false)
    if (result.ok) onSaved()
    else setError(result.error)
  }

  const projectKey = projectKeyOf(draft.issueKey)

  const footer = (
    <>
      {confirmDelete ? (
        <>
          <span className="hint">{t('calendar.editor.confirmDelete')}</span>
          <button className="btn btn-sm btn-danger" disabled={busy} onClick={remove}>
            {busy && <span className="spinner" />}
            {t('calendar.editor.confirmDeleteYes')}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={() => setConfirmDelete(false)}
          >
            {t('app.cancel')}
          </button>
        </>
      ) : (
        <button
          className="btn btn-ghost btn-danger"
          disabled={busy || regenerating}
          onClick={() => setConfirmDelete(true)}
        >
          {t('calendar.editor.delete')}
        </button>
      )}
      <span style={{ flex: 1 }} />
      <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
        {t('app.cancel')}
      </button>
      <button className="btn btn-primary" disabled={busy || regenerating} onClick={save}>
        {busy && <span className="spinner" />}
        {t('app.save')}
      </button>
    </>
  )

  return (
    <Modal title={t('calendar.editor.title')} onClose={onClose} footer={footer}>
      {error && <ErrorBanner error={error} />}
      <div className="suggestion-row-grid">
        <div className="field">
          <label>{t('wizard.issue')}</label>
          <IssueAutocomplete
            value={draft.issueKey}
            valueTypeName={draft.issueTypeName}
            valueIsSubtask={draft.issueIsSubtask}
            connectionId={entry.connectionId}
            jiraBaseUrl={jiraBaseUrl}
            projectKeys={projectKey ? [projectKey] : []}
            onChange={(issue) =>
              patch({
                issueKey: issue.key,
                issueSummary: issue.summary,
                issueTypeName: issue.typeName,
                issueIsSubtask: issue.isSubtask
              })
            }
          />
          {draft.issueSummary && <span className="hint">{draft.issueSummary}</span>}
        </div>
        <div className="field">
          <label>{t('wizard.date')}</label>
          <input type="date" value={draft.date} onChange={(e) => patch({ date: e.target.value })} />
        </div>
        <div className="field">
          <label>{t('wizard.hours')}</label>
          <input
            type="number"
            min={0.25}
            max={24}
            step={0.25}
            value={draft.hours}
            onChange={(e) => patch({ hours: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="field">
        <label>{t('wizard.description')}</label>
        <textarea value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
      </div>

      {regenerateOpen ? (
        <div className="regenerate-box">
          <input
            autoFocus
            value={hint}
            placeholder={t('wizard.regenerateHintPlaceholder')}
            aria-label={t('wizard.regenerateHint')}
            onChange={(e) => setHint(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !regenerating && void regenerate()}
          />
          <button className="btn btn-sm btn-primary" disabled={regenerating} onClick={regenerate}>
            {regenerating ? <span className="spinner" /> : t('wizard.regenerateRun')}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setRegenerateOpen(false)}>
            {t('app.cancel')}
          </button>
        </div>
      ) : (
        <button className="btn btn-ghost btn-sm" onClick={() => setRegenerateOpen(true)}>
          ↻ {t('wizard.regenerate')}
        </button>
      )}

      {customFields.length > 0 && (
        <div className="suggestion-custom-fields">
          {customFields.map((field) => {
            const value = draft.customFields[field.key]
            const setValue = (next: string | boolean): void =>
              patch({ customFields: { ...draft.customFields, [field.key]: next } })
            return field.type === 'boolean' ? (
              <label key={field.id} className="settings-checkbox" title={field.key}>
                <input
                  type="checkbox"
                  checked={value === true || value === 'true'}
                  onChange={(e) => setValue(e.target.checked)}
                />
                {field.label}
              </label>
            ) : (
              <div key={field.id} className="field suggestion-custom-field-text">
                <label title={field.key}>{field.label}</label>
                <input
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
