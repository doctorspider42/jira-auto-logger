import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppError, JiraIssue, JiraIssueType, NewIssueDraft } from '@shared/domain'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { Icon } from '@/components/common/Icon'
import { useDialogEscape } from '@/components/common/Modal'
import { IssueTypeIcon } from '@/components/wizard/IssueTypeIcon'
import { forgetIssuePool } from '@/components/wizard/IssueAutocomplete'
import './issues.css'

/** A Jira project a new issue can go to. */
export interface IssueTarget {
  connectionId: string
  connectionName: string
  projectKey: string
  projectName: string
}

interface Props {
  /**
   * `draft` only describes the issue - the wizard creates it when the time is
   * logged; `create` creates it in Jira right away.
   */
  mode: 'draft' | 'create'
  targets: IssueTarget[]
  initial?: Partial<NewIssueDraft>
  /** Context under the title, e.g. which suggestion the issue comes from. */
  subtitle?: string
  onSave?: (draft: NewIssueDraft) => void
  onCreated?: (issue: JiraIssue, target: IssueTarget) => void
  onClose: () => void
}

/** Session cache of issue types per connection and project. */
const typeCache = new Map<string, JiraIssueType[]>()

/** Side sheet for describing a new Jira issue: project, type, summary, description. */
export function NewIssuePanel({ mode, targets, initial, subtitle, onSave, onCreated, onClose }: Props): JSX.Element {
  const { t } = useTranslation()
  useDialogEscape(onClose)
  const [targetIndex, setTargetIndex] = useState(0)
  const target = targets[targetIndex]
  const [types, setTypes] = useState<JiraIssueType[]>([])
  const [typeId, setTypeId] = useState(initial?.issueTypeId ?? '')
  const [summary, setSummary] = useState(initial?.summary ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [assignToMe, setAssignToMe] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppError | null>(null)

  useEffect(() => {
    if (!target) return
    const cacheKey = `${target.connectionId}|${target.projectKey}`
    const apply = (list: JiraIssueType[]): void => {
      const regular = list.filter((type) => !type.subtask)
      setTypes(regular)
      // Keep the picked type when it exists here, else default to Task.
      setTypeId((current) => {
        if (regular.some((type) => type.id === current)) return current
        const task = regular.find((type) => /^(task|zadanie)$/i.test(type.name))
        return (task ?? regular[0])?.id ?? ''
      })
    }
    const cached = typeCache.get(cacheKey)
    if (cached) {
      apply(cached)
      return
    }
    let cancelled = false
    void window.api.jira.getIssueTypes(target.connectionId, target.projectKey).then((result) => {
      if (cancelled) return
      if (result.ok) {
        typeCache.set(cacheKey, result.value)
        apply(result.value)
      } else {
        setError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [target])

  const typeName = types.find((type) => type.id === typeId)?.name ?? ''
  const canSave = Boolean(target) && summary.trim().length > 0 && !busy

  const save = async (): Promise<void> => {
    if (!canSave) return
    const draft: NewIssueDraft = {
      summary: summary.trim(),
      description: description.trim(),
      issueTypeId: typeId,
      issueTypeName: typeName
    }
    if (mode === 'draft') {
      onSave?.(draft)
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    const result = await window.api.jira.createIssue({
      connectionId: target.connectionId,
      projectKey: target.projectKey,
      issueTypeId: typeId,
      summary: draft.summary,
      description: draft.description,
      assignToMe
    })
    setBusy(false)
    if (result.ok) {
      forgetIssuePool(target.connectionId, target.projectKey)
      onCreated?.(result.value, target)
      onClose()
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label={t('issues.newTitle')}>
        <header className="sheet-header">
          <div className="sheet-heading">
            <h2>{t('issues.newTitle')}</h2>
            {subtitle && <span className="muted">{subtitle}</span>}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label={t('app.close')}>
            <Icon name="close" />
          </button>
        </header>

        <div className="sheet-body">
          {error && <ErrorBanner error={error} />}

          <div className="new-issue-where">
            <label className="field">
              <span>{t('issues.project')}</span>
              <select
                value={targetIndex}
                disabled={targets.length < 2}
                onChange={(e) => setTargetIndex(Number(e.target.value))}
              >
                {targets.map((option, index) => (
                  <option key={`${option.connectionId}|${option.projectKey}`} value={index}>
                    {option.projectKey} · {option.projectName} — {option.connectionName}
                  </option>
                ))}
              </select>
            </label>
            <div className="segmented" role="group" aria-label={t('issues.type')}>
              {types.map((type) => (
                <button key={type.id} className={type.id === typeId ? 'active' : ''} onClick={() => setTypeId(type.id)}>
                  <IssueTypeIcon typeName={type.name} isSubtask={type.subtask} />
                  {type.name}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>{t('issues.summary')}</span>
            <input
              className="new-issue-summary"
              autoFocus
              value={summary}
              maxLength={255}
              onChange={(e) => setSummary(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />
          </label>

          <label className="field">
            <span>{t('issues.description')}</span>
            <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          {mode === 'create' && (
            <label className="checkbox-label">
              <input type="checkbox" checked={assignToMe} onChange={(e) => setAssignToMe(e.target.checked)} />
              {t('issues.assignToMe')}
            </label>
          )}
        </div>

        <footer className="sheet-footer">
          {mode === 'draft' && <span className="muted">{t('issues.createdOnLog')}</span>}
          <span className="spacer" />
          <button className="btn btn-lg" onClick={onClose}>
            {t('app.cancel')}
          </button>
          <button className="btn btn-primary btn-lg" disabled={!canSave} onClick={() => void save()}>
            {busy && <span className="spinner" />}
            {mode === 'draft' ? t('issues.save') : t('issues.create')}
          </button>
        </footer>
      </aside>
    </div>
  )
}
