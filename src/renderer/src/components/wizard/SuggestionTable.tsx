import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { CustomFieldConfig, WorklogSuggestion } from '@shared/domain'
import { IssueAutocomplete } from './IssueAutocomplete'

interface DescriptionCellProps {
  value: string
  placeholder: string
  onChange(value: string): void
}

/**
 * Compact description input for the table that expands into a floating textarea
 * on focus, so long descriptions are comfortable to edit without giving every
 * row a tall cell. The popover is portalled to the body to escape the table's
 * horizontal scroll container.
 */
function DescriptionCell({ value, placeholder, onChange }: DescriptionCellProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null)

  const open = (): void => {
    const rect = inputRef.current?.getBoundingClientRect()
    if (rect) setBox({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 380) })
  }

  return (
    <div className="table-desc">
      <input
        ref={inputRef}
        className="table-desc-input"
        value={value}
        placeholder={placeholder}
        onFocus={open}
        onChange={(e) => onChange(e.target.value)}
      />
      {box &&
        createPortal(
          <>
            <div className="table-desc-backdrop" onMouseDown={() => setBox(null)} />
            <textarea
              className="table-desc-pop"
              autoFocus
              value={value}
              placeholder={placeholder}
              style={{ top: box.top, left: box.left, width: box.width }}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setBox(null)
              }}
            />
          </>,
          document.body
        )}
    </div>
  )
}

interface SuggestionTableProps {
  suggestions: WorklogSuggestion[]
  /** Connection the rows belong to - scopes issue search and Jira links. */
  connectionId: string
  jiraBaseUrl: string
  /** Jira project of the group; the issue picker is scoped to it. */
  projectKey: string
  customFields: CustomFieldConfig[]
  onChange(next: WorklogSuggestion): void
  onRemove(id: string): void
}

/**
 * Experimental compact alternative to the stacked SuggestionRow cards: one
 * dense table row per entry. Trades the per-row regenerate box and the full
 * description textarea for density, so many entries fit on screen at once.
 */
export function SuggestionTable({
  suggestions,
  connectionId,
  jiraBaseUrl,
  projectKey,
  customFields,
  onChange,
  onRemove
}: SuggestionTableProps): JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="suggestion-table-wrap">
      <table className="suggestion-table">
        <thead>
          <tr>
            <th className="col-issue">{t('wizard.issue')}</th>
            <th className="col-date">{t('wizard.date')}</th>
            <th className="col-hours">{t('wizard.hours')}</th>
            <th className="col-desc">{t('wizard.description')}</th>
            {customFields.map((field) => (
              <th key={field.id} className="col-field" title={field.key}>
                {field.label}
              </th>
            ))}
            <th className="col-remove" />
          </tr>
        </thead>
        <tbody>
          {suggestions.map((suggestion) => (
            <tr key={suggestion.id} className={suggestion.issueKey ? '' : 'invalid'}>
              <td className="col-issue">
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
              </td>
              <td className="col-date">
                <input
                  type="date"
                  value={suggestion.date}
                  onChange={(e) => onChange({ ...suggestion, date: e.target.value })}
                />
              </td>
              <td className="col-hours">
                <input
                  type="number"
                  min={0.25}
                  max={24}
                  step={0.25}
                  value={suggestion.hours}
                  onChange={(e) => onChange({ ...suggestion, hours: Number(e.target.value) })}
                />
              </td>
              <td className="col-desc">
                <DescriptionCell
                  value={suggestion.description}
                  placeholder={t('wizard.description')}
                  onChange={(description) => onChange({ ...suggestion, description })}
                />
              </td>
              {customFields.map((field) => {
                const value = suggestion.customFields[field.key]
                const setValue = (next: string | boolean): void =>
                  onChange({
                    ...suggestion,
                    customFields: { ...suggestion.customFields, [field.key]: next }
                  })
                return (
                  <td key={field.id} className="col-field">
                    {field.type === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={value === true}
                        aria-label={field.label}
                        onChange={(e) => setValue(e.target.checked)}
                      />
                    ) : (
                      <input
                        value={typeof value === 'string' ? value : ''}
                        aria-label={field.label}
                        onChange={(e) => setValue(e.target.value)}
                      />
                    )}
                  </td>
                )
              })}
              <td className="col-remove">
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => onRemove(suggestion.id)}
                  title={t('wizard.removeEntry')}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
