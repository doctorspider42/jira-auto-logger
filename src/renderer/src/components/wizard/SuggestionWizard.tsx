import { useEffect, useMemo, useRef, useState } from 'react'
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
import { HelpTip } from '@/components/common/HelpTip'
import { FunnyLoader } from '@/components/common/FunnyLoader'
import { Icon } from '@/components/common/Icon'
import { Modal, useDialogEscape } from '@/components/common/Modal'
import { findDraft, useAppStore, type WizardDraft } from '@/store/appStore'
import { useThemeText } from '@/theme/useThemeCopy'
import { dateLocale, formatHours } from '@/utils/format'
import { SuggestionRow } from './SuggestionRow'
import { SuggestionTable } from './SuggestionTable'
import './wizard.css'

interface SuggestionWizardProps {
  dates: string[]
  /** Generate immediately from the last-used projects after a scheduler notification click. */
  autoStart?: boolean
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
 *
 * Closing the popup does not throw the work away: the whole state is parked in
 * the store as a draft and restored when those days are opened again. Only
 * "discard" - or a successful submit - clears it.
 */
export function SuggestionWizard({
  dates,
  autoStart = false,
  onClose,
  onDone
}: SuggestionWizardProps): JSX.Element {
  const { t } = useTranslation()
  const tt = useThemeText()
  const config = useAppStore((s) => s.config)
  const rememberLastUsed = useAppStore((s) => s.rememberLastUsed)
  const saveDraft = useAppStore((s) => s.saveDraft)
  const discardDraft = useAppStore((s) => s.discardDraft)

  // Read once: the caller remounts the wizard (keyed by dates) whenever the
  // days change, so a draft picked up at mount stays the right one.
  const [restored] = useState(() => findDraft(useAppStore.getState().drafts, dates))

  const [step, setStep] = useState<Step>(restored?.step ?? 'input')
  /** Step-2 layout: stacked cards (default) or the experimental dense table. */
  const [layout, setLayout] = useState<'cards' | 'table'>(restored?.layout ?? 'cards')
  /** Selected projects with their per-generation inputs, in selection order. */
  const [selections, setSelections] = useState<ProjectSelection[]>(() =>
    restored?.selections ??
    (autoStart
      ? config.lastUsed.selections.filter((selection) => {
          const project = config.projects.find((candidate) => candidate.id === selection.projectId)
          return project && !project.archived
        })
      : [])
  )

  const [groups, setGroups] = useState<ProjectSuggestions[]>(restored?.groups ?? [])
  /** When set, step 2 shows only the entries of this date. */
  const [dateFilter, setDateFilter] = useState<string | null>(restored?.dateFilter ?? null)
  const [commitsByProject, setCommitsByProject] = useState<Record<string, CommitInfo[]>>(
    restored?.commitsByProject ?? {}
  )
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

  const autoStarted = useRef(false)
  useEffect(() => {
    // A parked generation for this day is shown as it is - the scheduler must
    // not silently replace suggestions the user already edited.
    if (restored?.groups.length) return
    if (!autoStart || selections.length === 0 || autoStarted.current) return
    autoStarted.current = true
    void generate()
    // The scheduled wizard must run exactly once with its mount-time selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- Draft persistence ----------

  /** Set when the draft must NOT be parked: explicit discard, or a done submit. */
  const dropped = useRef(false)
  const latest = useRef<WizardDraft | null>(null)
  // Cheaper than writing to the store on every keystroke: the store only needs
  // the final state, so keep a snapshot and park it once, on unmount.
  useEffect(() => {
    latest.current = { dates, step, layout, selections, groups, commitsByProject, dateFilter }
  })
  useEffect(
    () => () => {
      const draft = latest.current
      if (dropped.current || !draft) return
      // Nothing typed and nothing generated - don't mark the day with an empty draft.
      if (draft.groups.length === 0 && draft.selections.length === 0) discardDraft(dates)
      else saveDraft(draft)
    },
    // Runs once, on unmount, over whatever the last render left in the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const discard = (): void => {
    dropped.current = true
    discardDraft(dates)
    onClose()
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

  /**
   * A day's target: the working day once per Jira it is logged to, since a
   * project mirrored into two Jiras logs a full day in each.
   */
  const targetByDate = useMemo(() => {
    const jiras = new Map<string, Set<string>>()
    for (const group of groups) {
      for (const s of group.suggestions) {
        jiras.set(s.date, (jiras.get(s.date) ?? new Set()).add(group.connectionId))
      }
    }
    return (date: string): number => targetHours * Math.max(1, jiras.get(date)?.size ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, targetHours])

  const hoursStatus = (hours: number, target: number): string =>
    hours === target ? 'ok' : hours < target ? 'under' : 'over'

  /** Sum over every project of whatever the day filter currently shows. */
  const visibleSuggestions = dateFilter
    ? allSuggestions.filter((s) => s.date === dateFilter)
    : allSuggestions
  const visibleTotal = visibleSuggestions.reduce((sum, s) => sum + s.hours, 0)
  const visibleTarget = dateFilter
    ? targetByDate(dateFilter)
    : tabDates.reduce((sum, date) => sum + targetByDate(date), 0)

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
    dropped.current = true
    discardDraft(dates)
    onDone()
  }

  const canGenerate = selections.length > 0
  useDialogEscape(onClose)

  const locale = dateLocale(config.language)
  const sortedDates = [...dates].sort()
  const rangeLabel =
    sortedDates.length === 1
      ? format(new Date(sortedDates[0]), 'EEEE, d MMMM', { locale })
      : `${format(new Date(sortedDates[0]), 'd MMM', { locale })} – ${format(new Date(sortedDates[sortedDates.length - 1]), 'd MMM', { locale })}`

  // Every pass reports its own model; normally they match, but a config change
  // between a restored draft and a regeneration can mix them.
  const usedModels = [...new Set(groups.flatMap((g) => (g.model ? [g.model] : [])))]

  const steps = [
    { id: 'input', label: t('wizard.stepContext') },
    { id: 'suggestions', label: t('wizard.stepReview') },
    { id: 'log', label: t('wizard.stepLog') }
  ]
  const stepIndex = step === 'input' ? 0 : 1

  const renderSelectionCard = (selection: ProjectSelection): JSX.Element | null => {
    const project = projectById.get(selection.projectId)
    if (!project) return null
    const targetLabels = project.targets.map((target) => {
      const connection = config.connections.find((c) => c.id === target.connectionId)
      return connection
        ? `${target.jiraProjectKey} · ${connection.name || connection.jira.baseUrl}`
        : target.jiraProjectKey
    })
    return (
      <section key={project.id} className="wizard-card">
        <header className="wizard-card-head">
          <span className="chip-dot" style={{ background: project.color || 'var(--muted)' }} />
          <h2>{project.name}</h2>
          <span className="mono muted">{targetLabels.join(' + ')}</span>
          {project.targets.length > 1 && (
            <span className="tag">{t('wizard.multiTargetTag', { count: project.targets.length })}</span>
          )}
        </header>
        {project.gitFolders.length > 0 && (
          <div className="wizard-commits">
            <label className="switch">
              <input
                type="checkbox"
                checked={selection.useCommits}
                onChange={(e) => patchSelection(project.id, { useCommits: e.target.checked })}
              />
              {t('wizard.includeCommits')}
            </label>
            <span className="mono muted">
              {project.gitFolders.map((f) => f.label || f.path).join(', ')}
            </span>
          </div>
        )}
        <label className="field wizard-note">
          <span className="muted">{t('wizard.projectNote')}</span>
          <textarea
            value={selection.note}
            placeholder={t('wizard.projectNotePlaceholder')}
            onChange={(e) => patchSelection(project.id, { note: e.target.value })}
          />
        </label>
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

    return (
      <section key={group.targetId} className="wizard-group">
        <header className="wizard-group-head">
          <span className="chip-dot" style={{ background: project?.color || 'var(--muted)' }} />
          <h2>{group.projectName}</h2>
          <span className="mono muted">
            {group.jiraProjectKey} · {group.connectionName}
          </span>
          <span className="spacer" />
          <span className="mono muted">
            {formatHours(visibleHours * 3600)}
            {t('app.hoursShort')}
          </span>
        </header>
        {layout === 'table' ? (
          <SuggestionTable
            suggestions={visible}
            connectionId={group.connectionId}
            jiraBaseUrl={connection?.jira.baseUrl ?? ''}
            projectKey={group.jiraProjectKey}
            customFields={fieldsForConnection(group.connectionId)}
            onChange={(next) =>
              patchGroup(group.targetId, (list) => list.map((s) => (s.id === next.id ? next : s)))
            }
            onRemove={(id) => patchGroup(group.targetId, (list) => list.filter((s) => s.id !== id))}
          />
        ) : (
          visible.map((suggestion) => (
            <SuggestionRow
              key={suggestion.id}
              suggestion={suggestion}
              connectionId={group.connectionId}
              jiraBaseUrl={connection?.jira.baseUrl ?? ''}
              projectKey={group.jiraProjectKey}
              customFields={fieldsForConnection(group.connectionId)}
              freeText={
                selection?.note ??
                project?.targets.find((target) => target.id === group.targetId)?.instruction ??
                ''
              }
              commits={commitsByProject[group.projectId] ?? []}
              onChange={(next) =>
                patchGroup(group.targetId, (list) => list.map((s) => (s.id === next.id ? next : s)))
              }
              onRemove={() =>
                patchGroup(group.targetId, (list) => list.filter((s) => s.id !== suggestion.id))
              }
            />
          ))
        )}
        <button className="btn btn-ghost btn-sm wizard-add" onClick={() => addSuggestion(group)}>
          <Icon name="plus" size={14} />
          {t('wizard.addEntry')}
        </button>
      </section>
    )
  }

  /** Left column of the review step: a filter per day with its hours. */
  const renderDays = (): JSX.Element => {
    const totalAll = allSuggestions.reduce((sum, s) => sum + s.hours, 0)
    const visibleTargetAll = tabDates.reduce((sum, date) => sum + targetByDate(date), 0)
    const dayButton = (key: string, label: string, hours: number, target: number, selected: boolean, onClick: () => void): JSX.Element => {
      const status = hoursStatus(hours, target)
      return (
        <button key={key} className={`wizard-day ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onClick}>
          <span className="wizard-day-row">
            <span>{label}</span>
            <span className={`mono wizard-hours ${status}`}>
              {formatHours(hours * 3600)}
              {t('app.hoursShort')} / {formatHours(target * 3600)}
              {t('app.hoursShort')}
            </span>
          </span>
          <span className="meter" aria-hidden>
            <span className={status} style={{ width: `${Math.min(100, (hours / Math.max(target, 0.01)) * 100)}%` }} />
          </span>
          {status === 'under' && (
            <span className="wizard-day-warn">
              {t('wizard.dayShort', { hours: formatHours((target - hours) * 3600) })}
            </span>
          )}
        </button>
      )
    }
    return (
      <div className="wizard-side-block">
        <span className="eyebrow">{t('wizard.days')}</span>
        {tabDates.length > 1 &&
          dayButton('all', t('wizard.allDays'), totalAll, visibleTargetAll, dateFilter === null, () =>
            setDateFilter(null)
          )}
        {tabDates.map((date) =>
          dayButton(
            date,
            format(new Date(date), 'EEE d MMM', { locale }),
            totalsByDate.get(date) ?? 0,
            targetByDate(date),
            dateFilter === date || tabDates.length === 1,
            () => setDateFilter(date)
          )
        )}
      </div>
    )
  }

  const notes = selections.filter((s) => s.note.trim())

  return (
    <div className="wizard-screen" role="dialog" aria-modal="true" aria-label={t('wizard.title')}>
      <header className="wizard-header">
        <button className="btn btn-icon" onClick={onClose} aria-label={t('app.close')}>
          <Icon name="close" />
        </button>
        <div className="wizard-heading">
          <span className="muted">{t('wizard.title')}</span>
          <h1>{rangeLabel}</h1>
        </div>
        <ol className="wizard-steps" aria-label={t('wizard.steps')}>
          {steps.map((s, i) => (
            <li key={s.id} className={i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''} aria-current={i === stepIndex ? 'step' : undefined}>
              <span className="wizard-step-mark">{i < stepIndex ? <Icon name="check" size={12} /> : i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>
        <span className="muted wizard-header-info">
          {step === 'suggestions' && usedModels.length > 0
            ? t('wizard.generatedWith', { models: usedModels.join(', ') })
            : t('wizard.dayCount', { count: dates.length })}
        </span>
      </header>

      <div className="wizard-body">
        <aside className="wizard-side">
          {step === 'input' ? (
            <div className="wizard-side-block">
              <div className="wizard-side-title">
                <span className="eyebrow">
                  {t('wizard.projects')}
                  <HelpTip label={t('wizard.helpLabel')}>{t('wizard.isolationHint')}</HelpTip>
                </span>
                <button className="link" onClick={useRecent}>
                  {t('wizard.useRecent')}
                </button>
              </div>
              {selectableProjects.length === 0 ? (
                <span className="hint">{t('wizard.noProjects')}</span>
              ) : (
                selectableProjects.map((project) => {
                  const checked = selections.some((s) => s.projectId === project.id)
                  return (
                    <label key={project.id} className={`wizard-pick ${checked ? 'selected' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleProject(project)} />
                      <span className="chip-dot" style={{ background: project.color || 'var(--muted)' }} />
                      <span className="wizard-pick-text">
                        <span>{project.name}</span>
                        <span className="mono muted">{project.targets.map((target) => target.jiraProjectKey).join(' · ')}</span>
                      </span>
                    </label>
                  )
                })
              )}
            </div>
          ) : (
            <>
              {renderDays()}
              {notes.length > 0 && (
                <div className="wizard-side-block">
                  <span className="eyebrow">{t('wizard.yourNotes')}</span>
                  {notes.map((n) => (
                    <p key={n.projectId} className="wizard-note-echo">
                      {n.note}
                    </p>
                  ))}
                </div>
              )}
              <button className="link wizard-edit-context" onClick={() => setStep('input')} disabled={busy}>
                {t('wizard.editContext')}
              </button>
            </>
          )}
        </aside>

        <main className="wizard-main">
          {error && <ErrorBanner error={error} />}
          {busy && step === 'input' && <FunnyLoader />}
          {step === 'input' ? (
            selections.length === 0 ? (
              <p className="wizard-empty muted">{t('wizard.pickProjects')}</p>
            ) : (
              selections.map(renderSelectionCard)
            )
          ) : (
            <>
              <div className="wizard-review-head">
                <p className="hint">
                  {t('wizard.reviewTitle')}
                  <HelpTip label={t('wizard.helpLabel')}>{t('wizard.suggestionsInfo')}</HelpTip>
                </p>
                <div className="segmented" role="group" aria-label={t('wizard.layout')}>
                  <button className={layout === 'cards' ? 'active' : ''} onClick={() => setLayout('cards')}>
                    {t('wizard.layoutCards')}
                  </button>
                  <button
                    className={layout === 'table' ? 'active' : ''}
                    onClick={() => setLayout('table')}
                    title={t('wizard.layoutTableHint')}
                  >
                    {t('wizard.layoutTable')}
                  </button>
                </div>
              </div>
              {groups.map(renderGroup)}
            </>
          )}
        </main>
      </div>

      <footer className="wizard-footer">
        {step === 'input' ? (
          <>
            <button
              className="btn btn-ghost"
              disabled={previewLoading || busy || !canGenerate}
              onClick={showPreview}
              title={t('wizard.previewContextHint')}
            >
              {previewLoading ? <span className="spinner" /> : <Icon name="code" size={15} />}
              {t('wizard.previewContext')}
            </button>
            <span className="muted">{t('wizard.passCount', { count: selections.length })}</span>
            <span className="spacer" />
            <button className="btn btn-lg" onClick={discard}>
              {t('app.cancel')}
            </button>
            <button className="btn btn-primary btn-lg" disabled={busy || !canGenerate} onClick={generate}>
              {busy ? t('wizard.generating') : t('wizard.generate')}
            </button>
          </>
        ) : (
          <>
            <span>
              <b>{visibleSuggestions.length}</b> <span className="muted">{t('wizard.entriesShown')}</span>
            </span>
            <span className={`mono wizard-hours ${hoursStatus(visibleTotal, visibleTarget)}`}>
              {formatHours(visibleTotal * 3600)}
              {t('app.hoursShort')} / {formatHours(visibleTarget * 3600)}
              {t('app.hoursShort')}
            </span>
            <span className="spacer" />
            <button className="btn btn-ghost" onClick={discard} disabled={busy}>
              {t('wizard.discard')}
            </button>
            <button className="btn btn-lg" onClick={() => setStep('input')} disabled={busy}>
              {t('app.back')}
            </button>
            <button
              className="btn btn-primary btn-lg"
              disabled={busy || allSuggestions.length === 0}
              onClick={submit}
            >
              {busy && <span className="spinner" />}
              {busy ? t('wizard.submitting') : tt('wizard.submit', { count: allSuggestions.length })}
            </button>
          </>
        )}
      </footer>

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
            <section key={section.label} className="wizard-preview-section">
              <h4>
                {section.label} — {t('wizard.previewTokens', { count: section.approxTokens })}
              </h4>
              <pre className="prompt-preview">{section.prompt}</pre>
            </section>
          ))}
        </Modal>
      )}
    </div>
  )
}
