import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppError, CommitInfo, CustomFieldConfig, WorklogSuggestion } from '@shared/domain'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { IssueAutocomplete } from './IssueAutocomplete'

interface SuggestionRowProps {
  suggestion: WorklogSuggestion
  /** Connection the row belongs to - scopes issue search and Jira links. */
  connectionId: string
  jiraBaseUrl: string
  /** Jira project of the row's group; the issue picker is scoped to it. */
  projectKey: string
  /** Custom fields configured for the row's connection. */
  customFields: CustomFieldConfig[]
  freeText: string
  commits: CommitInfo[]
  onChange(next: WorklogSuggestion): void
  onRemove(): void
}

/** One editable worklog suggestion: issue, date, hours, description. */
export function SuggestionRow({
  suggestion,
  connectionId,
  jiraBaseUrl,
  projectKey,
  customFields,
  freeText,
  commits,
  onChange,
  onRemove
}: SuggestionRowProps): JSX.Element {
  const { t } = useTranslation()
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [hint, setHint] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<AppError | null>(null)

  const regenerate = async (): Promise<void> => {
    setRegenerating(true)
    setError(null)
    const result = await window.api.llm.regenerateDescription({ suggestion, hint, freeText, commits })
    setRegenerating(false)
    if (result.ok) {
      onChange({ ...suggestion, description: result.value })
      setRegenerateOpen(false)
      setHint('')
    } else {
      setError(result.error)
    }
  }

  return (
    <div className={`suggestion-row card ${suggestion.issueKey ? '' : 'invalid'}`}>
      <div className="suggestion-row-grid">
        <div className="field">
          <label>{t('wizard.issue')}</label>
          <IssueAutocomplete
            value={suggestion.issueKey}
            valueTypeName={suggestion.issueTypeName}
            valueIsSubtask={suggestion.issueIsSubtask}
            connectionId={connectionId}
            jiraBaseUrl={jiraBaseUrl}
            projectKeys={projectKey ? [projectKey] : []}
            onChange={(issue) =>
              onChange({
                ...suggestion,
                issueKey: issue.key,
                issueSummary: issue.summary,
                issueTypeName: issue.typeName,
                issueIsSubtask: issue.isSubtask
              })
            }
          />
          {suggestion.issueSummary && <span className="hint">{suggestion.issueSummary}</span>}
        </div>
        <div className="field">
          <label>{t('wizard.date')}</label>
          <input
            type="date"
            value={suggestion.date}
            onChange={(e) => onChange({ ...suggestion, date: e.target.value })}
          />
        </div>
        <div className="field">
          <label>{t('wizard.hours')}</label>
          <input
            type="number"
            min={0.25}
            max={24}
            step={0.25}
            value={suggestion.hours}
            onChange={(e) => onChange({ ...suggestion, hours: Number(e.target.value) })}
          />
        </div>
        <button
          className="btn btn-ghost btn-sm btn-danger suggestion-remove"
          onClick={onRemove}
          title={t('wizard.removeEntry')}
        >
          ✕
        </button>
      </div>

      <div className="field">
        <label>{t('wizard.description')}</label>
        <textarea
          value={suggestion.description}
          onChange={(e) => onChange({ ...suggestion, description: e.target.value })}
        />
      </div>

      {customFields.length > 0 && (
        <div className="suggestion-custom-fields">
          {customFields.map((field) => {
            const value = suggestion.customFields[field.key]
            const setValue = (next: string | boolean): void =>
              onChange({
                ...suggestion,
                customFields: { ...suggestion.customFields, [field.key]: next }
              })
            return field.type === 'boolean' ? (
              <label key={field.id} className="settings-checkbox" title={field.key}>
                <input
                  type="checkbox"
                  checked={value === true}
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

      {error && <ErrorBanner error={error} onRetry={regenerate} />}

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
    </div>
  )
}
