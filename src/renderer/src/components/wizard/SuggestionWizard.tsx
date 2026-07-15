import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import type {
  AppError,
  CommitInfo,
  ProjectConfig,
  ProjectSelection,
  ProjectSuggestions,
  PromptPreview,
  WorklogSuggestion
} from '@shared/domain'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { FunnyLoader } from '@/components/common/FunnyLoader'
import { Modal } from '@/components/common/Modal'
import { useAppStore } from '@/store/appStore'
import { dateLocale, formatHours } from '@/utils/format'
import { SuggestionRow } from './SuggestionRow'
import './wizard.css'

interface SuggestionWizardProps {
  dates: string[]
  onClose(): void
  onDone(): void
}

type Step = 'input' | 'suggestions'

let clientId = 0
const nextId = (): string => `local-${++clientId}`

/**
 * Popup shown after selecting calendar days. Step 1: the user declares which
 * configured projects they worked on, with an optional note and a commits
 * toggle per project. Each project then gets its own isolated LLM pass.
 * Step 2 shows fully editable suggestions grouped by project and only
 * submits to Tempo after explicit confirmation.
 */
export function SuggestionWizard({ dates, onClose, onDone }: SuggestionWizardProps): JSX.Element {
  const { t } = useTranslation()
  const config = useAppStore((s) => s.config)
  const rememberLastUsed = useAppStore((s) => s.rememberLastUsed)

  const [step, setStep] = useState<Step>('input')
  /** Selected projects with their per-generation inputs, in selection order. */
  const [selections, setSelections] = useState<ProjectSelection[]>([])

  const [groups, setGroups] = useState<ProjectSuggestions[]>([])
  /** When set, step 2 shows only the entries of this date. */
  const [dateFilter, setDateFilter] = useState<string | null>(null)
  const [commitsByProject, setCommitsByProject] = useState<Record<string, CommitInfo[]>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [preview, setPreview] = useState<PromptPreview[] | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const projectById = useMemo(
    () => new Map(config.projects.map((p) => [p.id, p])),
    [config.projects]
  )

  // Archived projects keep colouring past entries but can't take new time.
  const selectableProjects = useMemo(
    () => config.projects.filter((p) => !p.archived),
    [config.projects]
  )

  const request = { dates, selections }

  const toggleProject = (project: ProjectConfig): void =>
    setSelections((current) =>
      current.some((s) => s.projectId === project.id)
        ? current.filter((s) => s.projectId !== project.id)
        : [...current, { projectId: project.id, note: '', useCommits: project.gitFolders.length > 0 }]
    )

  const patchSelection = (projectId: string, changes: Partial<ProjectSelection>): void =>
    setSelections((current) =>
      current.map((s) => (s.projectId === projectId ? { ...s, ...changes } : s))
    )

  const useRecent = (): void =>
    setSelections(
      config.lastUsed.selections.filter((s) => {
        const project = projectById.get(s.projectId)
        return project && !project.archived
      })
    )

  const showPreview = async (): Promise<void> => {
    setPreviewLoading(true)
    setError(null)
    const result = await window.api.llm.previewPrompt(request)
    setPreviewLoading(false)
    if (result.ok) setPreview(result.value)
    else setError(result.error)
  }

  const generate = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    rememberLastUsed({ selections })

    const [suggestionsResult, commitResults] = await Promise.all([
      window.api.llm.generateSuggestions(request),
      Promise.all(
        selections.map(async (selection) => {
          const project = projectById.get(selection.projectId)
          if (!selection.useCommits || !project || project.gitFolders.length === 0) {
            return { projectId: selection.projectId, commits: [] as CommitInfo[] }
          }
          const result = await window.api.git.getCommits(
            project.gitFolders.map((f) => f.path),
            dates
          )
          return { projectId: selection.projectId, commits: result.ok ? result.value : [] }
        })
      )
    ])
    setBusy(false)

    if (!suggestionsResult.ok) {
      setError(suggestionsResult.error)
      return
    }
    setCommitsByProject(Object.fromEntries(commitResults.map((c) => [c.projectId, c.commits])))
    setGroups(suggestionsResult.value)
    // Multi-day runs start focused on the first day; the tabs make it obvious.
    setDateFilter(dates.length > 1 ? [...dates].sort()[0] : null)
    setStep('suggestions')
  }

  // Groups are one per (project, target) pair; the target id identifies them.
  const patchGroup = (
    targetId: string,
    update: (suggestions: WorklogSuggestion[]) => WorklogSuggestion[]
  ): void =>
    setGroups((all) =>
      all.map((g) => (g.targetId === targetId ? { ...g, suggestions: update(g.suggestions) } : g))
    )

  const fieldsForConnection = (connectionId: string) =>
    config.customFields.filter((f) => f.connectionId === connectionId)

  const addSuggestion = (group: ProjectSuggestions): void =>
    patchGroup(group.targetId, (list) => [
      ...list,
      {
        id: nextId(),
        date: dateFilter ?? dates[0],
        projectKey: group.jiraProjectKey,
        issueKey: '',
        issueSummary: '',
        issueTypeName: '',
        issueIsSubtask: false,
        description: '',
        hours: 1,
        customFields: Object.fromEntries(
          fieldsForConnection(group.connectionId).map((f) => [f.key, f.type === 'boolean' ? false : ''])
        )
      }
    ])

  const allSuggestions = groups.flatMap((g) => g.suggestions)

  // ---------- Day tabs (step 2) ----------

  const targetHours = config.workingHoursPerDay
  /** Requested dates plus any date an entry was manually moved to. */
  const tabDates = useMemo(
    () => [...new Set([...dates, ...allSuggestions.map((s) => s.date)])].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dates, groups]
  )
  const totalsByDate = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of allSuggestions) map.set(s.date, (map.get(s.date) ?? 0) + s.hours)
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])

  const hoursStatus = (hours: number, target: number): string =>
    hours === target ? 'ok' : hours < target ? 'under' : 'over'

  const renderDayTabs = (): JSX.Element | null => {
    if (tabDates.length < 2) return null
    const locale = dateLocale(config.language)
    const totalAll = allSuggestions.reduce((sum, s) => sum + s.hours, 0)
    return (
      <div className="day-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={dateFilter === null}
          className={`day-tab ${dateFilter === null ? 'selected' : ''}`}
          onClick={() => setDateFilter(null)}
        >
          <span className="day-tab-weekday">{t('wizard.allDays')}</span>
          <span className="day-tab-date">{tabDates.length} × {formatHours(targetHours * 3600)}h</span>
          <span className={`day-tab-hours ${hoursStatus(totalAll, targetHours * tabDates.length)}`}>
            {formatHours(totalAll * 3600)}h
          </span>
        </button>
        {tabDates.map((date) => {
          const day = new Date(date)
          const hours = totalsByDate.get(date) ?? 0
          return (
            <button
              key={date}
              role="tab"
              aria-selected={dateFilter === date}
              className={`day-tab ${dateFilter === date ? 'selected' : ''}`}
              onClick={() => setDateFilter(date)}
            >
              <span className="day-tab-weekday">{format(day, 'EEEE', { locale })}</span>
              <span className="day-tab-date">{format(day, 'd MMM', { locale })}</span>
              <span className={`day-tab-hours ${hoursStatus(hours, targetHours)}`}>
                {formatHours(hours * 3600)}/{formatHours(targetHours * 3600)}h
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  const submit = async (): Promise<void> => {
    if (allSuggestions.some((s) => !s.issueKey.trim())) {
      setError({ code: 'CONFIG_INVALID', message: t('wizard.missingIssue') })
      return
    }
    setBusy(true)
    setError(null)
    for (const group of groups) {
      if (group.suggestions.length === 0) continue
      const fields = fieldsForConnection(group.connectionId)
      const result = await window.api.tempo.createWorklogs(
        group.connectionId,
        group.suggestions.map((s) => ({
          issueKey: s.issueKey.trim().toUpperCase(),
          description: s.description.trim(),
          timeSpentSeconds: Math.round(s.hours * 3600),
          startDate: s.date,
          // Booleans always go out; empty strings would clear nothing, so skip them.
          attributes: fields
            .map((f) => ({ key: f.key, value: s.customFields[f.key] ?? (f.type === 'boolean' ? false : '') }))
            .filter((a) => typeof a.value === 'boolean' || a.value !== '')
        }))
      )
      if (!result.ok) {
        // Entries of earlier projects are already logged; surface which one failed.
        setBusy(false)
        setError({
          ...result.error,
          message: `[${group.projectName}] ${result.error.message}`
        })
        return
      }
    }
    setBusy(false)
    onDone()
  }

  const canGenerate = selections.length > 0

  const inputFooter = (
    <>
      <button
        className="btn btn-ghost"
        disabled={previewLoading || busy || !canGenerate}
        onClick={showPreview}
        title={t('wizard.previewContextHint')}
      >
        {previewLoading ? <span className="spinner" /> : '{ }'} {t('wizard.previewContext')}
      </button>
      <span style={{ flex: 1 }} />
      <button className="btn btn-ghost" onClick={onClose}>
        {t('app.cancel')}
      </button>
      <button className="btn btn-primary" disabled={busy || !canGenerate} onClick={generate}>
        {busy ? t('wizard.generating') : t('wizard.generate')}
      </button>
    </>
  )

  const suggestionsFooter = (
    <>
      <button className="btn btn-ghost" onClick={() => setStep('input')} disabled={busy}>
        {t('app.back')}
      </button>
      <button
        className="btn btn-primary"
        disabled={busy || allSuggestions.length === 0}
        onClick={submit}
      >
        {busy && <span className="spinner" />}
        {busy ? t('wizard.submitting') : t('wizard.submit', { count: allSuggestions.length })}
      </button>
    </>
  )

  const renderSelectionSection = (selection: ProjectSelection): JSX.Element | null => {
    const project = projectById.get(selection.projectId)
    if (!project) return null
    const targetLabels = project.targets.map((target) => {
      const connection = config.connections.find((c) => c.id === target.connectionId)
      return connection
        ? `${target.jiraProjectKey} · ${connection.name || connection.jira.baseUrl}`
        : target.jiraProjectKey
    })
    return (
      <section key={project.id} className="wizard-project-section card">
        <h4>
          {project.name}
          <span className="hint"> {targetLabels.join(' + ')}</span>
        </h4>
        {project.targets.length > 1 && (
          <p className="hint">{t('wizard.multiTargetHint', { count: project.targets.length })}</p>
        )}
        {project.gitFolders.length > 0 && (
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={selection.useCommits}
              onChange={(e) => patchSelection(project.id, { useCommits: e.target.checked })}
            />
            {t('wizard.useRepoCommits', {
              folders: project.gitFolders.map((f) => f.label || f.path).join(', ')
            })}
          </label>
        )}
        <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
          <label>{t('wizard.projectNote')}</label>
          <textarea
            value={selection.note}
            placeholder={t('wizard.projectNotePlaceholder')}
            onChange={(e) => patchSelection(project.id, { note: e.target.value })}
          />
        </div>
      </section>
    )
  }

  const renderGroup = (group: ProjectSuggestions): JSX.Element => {
    const project = projectById.get(group.projectId)
    const connection = config.connections.find((c) => c.id === group.connectionId)
    const selection = selections.find((s) => s.projectId === group.projectId)
    const visible = dateFilter
      ? group.suggestions.filter((s) => s.date === dateFilter)
      : group.suggestions
    const visibleHours = visible.reduce((sum, s) => sum + s.hours, 0)
    // A multi-target project produces one group per Jira - label them apart.
    const multiTarget = (project?.targets.length ?? 0) > 1

    return (
      <section key={group.targetId} className="wizard-connection-group">
        <h4>
          {project?.color && (
            <span className="project-color-dot" style={{ background: project.color }} />
          )}
          {group.projectName}
          <span className="hint">
            {multiTarget
              ? ` · ${group.jiraProjectKey} · ${group.connectionName}`
              : ''}
            {' · '}
            {formatHours(visibleHours * 3600)}h
          </span>
        </h4>
        {visible.map((suggestion) => (
          <SuggestionRow
            key={suggestion.id}
            suggestion={suggestion}
            connectionId={group.connectionId}
            jiraBaseUrl={connection?.jira.baseUrl ?? ''}
            projectKey={group.jiraProjectKey}
            customFields={fieldsForConnection(group.connectionId)}
            freeText={selection?.note ?? project?.instruction ?? ''}
            commits={commitsByProject[group.projectId] ?? []}
            onChange={(next) =>
              patchGroup(group.targetId, (list) => list.map((s) => (s.id === next.id ? next : s)))
            }
            onRemove={() =>
              patchGroup(group.targetId, (list) => list.filter((s) => s.id !== suggestion.id))
            }
          />
        ))}
        <button className="btn" onClick={() => addSuggestion(group)}>
          + {t('wizard.addEntry')}
        </button>
      </section>
    )
  }

  return (
    <Modal
      title={`${t('wizard.title')} — ${step === 'input' ? t('wizard.step1') : t('wizard.step2')}`}
      onClose={onClose}
      footer={step === 'input' ? inputFooter : suggestionsFooter}
    >
      {error && <ErrorBanner error={error} />}
      {busy && step === 'input' && <FunnyLoader />}

      {step === 'input' ? (
        <>
          <div className="field">
            <div className="wizard-label-row">
              <label>{t('wizard.projects')}</label>
              <button className="btn btn-ghost btn-sm" onClick={useRecent}>
                ⟲ {t('wizard.useRecent')}
              </button>
            </div>
            {selectableProjects.length === 0 ? (
              <span className="hint">{t('wizard.noProjects')}</span>
            ) : (
              <div className="chip-list">
                {selectableProjects.map((project) => (
                  <button
                    key={project.id}
                    className={`chip ${selections.some((s) => s.projectId === project.id) ? 'selected' : ''}`}
                    title={project.targets.map((target) => target.jiraProjectKey).join(', ')}
                    onClick={() => toggleProject(project)}
                  >
                    {project.color && (
                      <span className="project-color-dot" style={{ background: project.color }} />
                    )}
                    {project.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selections.map(renderSelectionSection)}
        </>
      ) : (
        <>
          {renderDayTabs()}
          <p className="hint wizard-info">{t('wizard.suggestionsInfo')}</p>
          {groups.map(renderGroup)}
        </>
      )}

      {preview && (
        <Modal
          title={t('wizard.previewTitle')}
          onClose={() => setPreview(null)}
          footer={
            <button className="btn" onClick={() => setPreview(null)}>
              {t('app.close')}
            </button>
          }
        >
          {preview.map((section) => (
            <section key={section.label} className="wizard-connection-group">
              <h4>
                {section.label} — {t('wizard.previewTokens', { count: section.approxTokens })}
              </h4>
              <pre className="prompt-preview">{section.prompt}</pre>
            </section>
          ))}
        </Modal>
      )}
    </Modal>
  )
}
