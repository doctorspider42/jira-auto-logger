import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PROJECT_COLOR_PALETTE } from '@shared/domain'
import type { AppError, GitFolder, JiraProject, ProjectConfig, ProjectTarget } from '@shared/domain'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { Icon } from '@/components/common/Icon'
import { Modal } from '@/components/common/Modal'
import { useAppStore } from '@/store/appStore'
import './projects.css'

/**
 * Standalone project management view (main menu, next to the calendar).
 * A project pins one or more Jira projects (targets - e.g. the client's Jira
 * and the company Jira), optional repositories (each with its commit-author
 * filter); each target carries its own standing LLM instruction.
 */
export function ProjectsView(): JSX.Element {
  const { t } = useTranslation()
  const config = useAppStore((s) => s.config)
  const saveConfig = useAppStore((s) => s.saveConfig)

  const [projects, setProjects] = useState<ProjectConfig[]>(() => structuredClone(config.projects))
  const [jiraProjectsByConnection, setJiraProjectsByConnection] = useState<Record<string, JiraProject[]>>({})
  const [savedFlash, setSavedFlash] = useState(false)
  const [showBlockReason, setShowBlockReason] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(() => config.projects[0]?.id ?? null)

  const dirty = useMemo(
    () => JSON.stringify(projects) !== JSON.stringify(config.projects),
    [projects, config.projects]
  )

  const ensureJiraProjects = (connectionId: string): void => {
    if (!connectionId || jiraProjectsByConnection[connectionId]) return
    void window.api.jira.getProjects(connectionId).then((result) => {
      if (result.ok) {
        setJiraProjectsByConnection((all) => ({ ...all, [connectionId]: result.value }))
      }
    })
  }

  const patchProject = (id: string, changes: Partial<ProjectConfig>): void =>
    setProjects((all) => all.map((p) => (p.id === id ? { ...p, ...changes } : p)))

  const patchTarget = (project: ProjectConfig, targetId: string, changes: Partial<ProjectTarget>): void =>
    patchProject(project.id, {
      targets: project.targets.map((t) => (t.id === targetId ? { ...t, ...changes } : t))
    })

  const addTarget = (project: ProjectConfig): void =>
    patchProject(project.id, {
      targets: [
        ...project.targets,
        {
          id: crypto.randomUUID(),
          connectionId: config.connections[0]?.id ?? '',
          jiraProjectKey: '',
          instruction: ''
        }
      ]
    })

  const removeTarget = (project: ProjectConfig, targetId: string): void =>
    patchProject(project.id, { targets: project.targets.filter((t) => t.id !== targetId) })

  const addProject = (): void => {
    const id = crypto.randomUUID()
    setSelectedId(id)
    setProjects((all) => [
      ...all,
      {
        id,
        name: '',
        targets: [
          {
            id: crypto.randomUUID(),
            connectionId: config.connections[0]?.id ?? '',
            jiraProjectKey: '',
            instruction: ''
          }
        ],
        gitFolders: [],
        color: PROJECT_COLOR_PALETTE[projects.length % PROJECT_COLOR_PALETTE.length],
        archived: false
      }
    ])
  }

  const patchFolder = (project: ProjectConfig, index: number, changes: Partial<GitFolder>): void =>
    patchProject(project.id, {
      gitFolders: project.gitFolders.map((f, i) => (i === index ? { ...f, ...changes } : f))
    })

  const addFolder = async (project: ProjectConfig): Promise<void> => {
    const path = await window.api.dialog.pickFolder()
    if (!path) return
    const label = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
    patchProject(project.id, {
      gitFolders: [...project.gitFolders, { path, label, author: '', includeAllAuthors: false }]
    })
  }

  const changeFolder = async (project: ProjectConfig, index: number): Promise<void> => {
    const path = await window.api.dialog.pickFolder()
    if (!path) return
    const label = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
    patchFolder(project, index, { path, label })
  }

  const removeFolder = (project: ProjectConfig, index: number): void =>
    patchProject(project.id, { gitFolders: project.gitFolders.filter((_, i) => i !== index) })

  /**
   * Name and at least one complete target are required; a repo needs an author.
   * Archived projects can't be logged to, so an incomplete one never blocks a
   * save - you can archive a project and move on without fixing its config.
   */
  const invalidProjects = projects.filter(
    (p) =>
      !p.archived &&
      (!p.name.trim() ||
        p.targets.length === 0 ||
        p.targets.some((target) => !target.connectionId || !target.jiraProjectKey.trim()) ||
        p.gitFolders.some((f) => !f.includeAllAuthors && !f.author.trim()))
  )

  const saveBlocked = invalidProjects.length > 0

  const save = async (): Promise<void> => {
    // Kept clickable while blocked so the reason is reachable (see settings).
    if (saveBlocked) {
      setShowBlockReason(true)
      return
    }
    setError(null)
    const result = await saveConfig({ ...config, projects })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2500)
  }

  /** Reverts every unsaved edit back to the persisted projects. */
  const discard = (): void => {
    setProjects(structuredClone(config.projects))
    setError(null)
    setShowBlockReason(false)
  }

  // ---------- Delete / archive (immediate, no Save needed) ----------
  const [confirmDelete, setConfirmDelete] = useState<ProjectConfig | null>(null)

  /**
   * Persists a single project change against the SAVED config, not the draft,
   * so deleting/archiving one project never silently commits other pending
   * edits. The matching draft edit is applied separately for the live view.
   */
  const persistProjects = async (next: ProjectConfig[]): Promise<void> => {
    setError(null)
    const result = await saveConfig({ ...config, projects: next })
    if (!result.ok) setError(result.error)
  }

  const deleteProject = async (project: ProjectConfig): Promise<void> => {
    setConfirmDelete(null)
    setProjects((all) => all.filter((p) => p.id !== project.id))
    // Only touch storage if it was actually saved (a never-saved draft project
    // just disappears from the draft).
    if (config.projects.some((p) => p.id === project.id)) {
      await persistProjects(config.projects.filter((p) => p.id !== project.id))
    }
  }

  const archiveFromDialog = async (project: ProjectConfig): Promise<void> => {
    setConfirmDelete(null)
    setProjects((all) => all.map((p) => (p.id === project.id ? { ...p, archived: true } : p)))
    if (config.projects.some((p) => p.id === project.id)) {
      await persistProjects(
        config.projects.map((p) => (p.id === project.id ? { ...p, archived: true } : p))
      )
    }
  }

  /** Highlight a required field red once a blocked save has been attempted. */
  const errorClass = (bad: boolean): string | undefined =>
    showBlockReason && bad ? 'input-error' : undefined

  const project = projects.find((p) => p.id === selectedId) ?? projects[0]
  const connectionName = (id: string): string => {
    const connection = config.connections.find((c) => c.id === id)
    return connection ? connection.name || connection.jira.baseUrl : '—'
  }

  return (
    <div className={`master-detail ${showBlockReason && saveBlocked ? 'save-attempted' : ''}`}>
      <nav className="md-list" aria-label={t('app.projects')}>
        <div className="md-list-head">
          <h1 className="page-title">{t('app.projects')}</h1>
          <button
            className="btn btn-icon"
            onClick={addProject}
            disabled={config.connections.length === 0}
            aria-label={t('settings.addProject')}
            title={t('settings.addProject')}
          >
            <Icon name="plus" />
          </button>
        </div>
        {projects.map((p) => {
          const invalid = invalidProjects.includes(p)
          return (
            <button
              key={p.id}
              className={`md-item ${p.id === project?.id ? 'active' : ''} ${p.archived ? 'archived' : ''}`}
              aria-current={p.id === project?.id ? 'page' : undefined}
              onClick={() => setSelectedId(p.id)}
            >
              <span className="md-item-swatch" style={{ background: `color-mix(in srgb, ${p.color || '#888'} 22%, transparent)` }}>
                <span style={{ background: p.color || 'var(--muted)' }} />
              </span>
              <span className="md-item-text">
                <span>{p.name.trim() || t('projects.unnamedTitle')}</span>
                <span className="muted">
                  {p.archived
                    ? t('projects.archivedBadge')
                    : [
                        p.targets.map((target) => target.jiraProjectKey || '?').join(' + '),
                        t('projects.repoCount', { count: p.gitFolders.length })
                      ].join(' · ')}
                </span>
              </span>
              {invalid && <span className="dot dot-warning" title={t('projects.invalidHint')} />}
            </button>
          )
        })}
        <p className="hint md-list-hint">{t('projects.hint')}</p>
      </nav>

      <main className="md-detail">
        {error && <ErrorBanner error={error} />}
        {config.connections.length === 0 && <p className="hint">{t('projects.noConnections')}</p>}

        {project && (
          <>
            <header className="md-detail-head">
              <span className="md-detail-color" style={{ background: project.color || 'var(--muted)' }} />
              <h2 className="page-title">{project.name.trim() || t('projects.unnamedTitle')}</h2>
              {project.archived && <span className="tag">{t('projects.archivedBadge')}</span>}
              <span className="spacer" />
              <button
                className="btn btn-ghost"
                onClick={() => patchProject(project.id, { archived: !project.archived })}
                title={project.archived ? t('projects.archivedHint') : t('projects.archiveHint')}
              >
                {project.archived ? t('projects.unarchive') : t('projects.archive')}
              </button>
              <button className="btn btn-ghost btn-danger" onClick={() => setConfirmDelete(project)}>
                {t('settings.removeProject')}
              </button>
            </header>

            <section className="form-section">
              <div className="form-section-intro">
                <h3>{t('projects.general')}</h3>
                <p>{t('projects.generalHint')}</p>
              </div>
              <div className="form-section-body">
                <label className="field">
                  <span>{t('settings.projectName')}</span>
                  <input
                    className={errorClass(!project.archived && !project.name.trim())}
                    value={project.name}
                    placeholder={t('settings.projectNamePlaceholder')}
                    onChange={(e) => patchProject(project.id, { name: e.target.value })}
                  />
                </label>
                <fieldset className="field swatch-field">
                  <legend>{t('projects.color')}</legend>
                  <div className="swatches">
                    {PROJECT_COLOR_PALETTE.map((color) => (
                      <button
                        key={color}
                        className={`swatch ${project.color === color ? 'selected' : ''}`}
                        style={{ background: color }}
                        aria-label={color}
                        aria-pressed={project.color === color}
                        onClick={() => patchProject(project.id, { color })}
                      />
                    ))}
                    <label className="swatch swatch-custom" title={t('projects.colorHint')}>
                      <input
                        type="color"
                        value={project.color || '#6d9eff'}
                        aria-label={t('projects.customColor')}
                        onChange={(e) => patchProject(project.id, { color: e.target.value })}
                      />
                    </label>
                  </div>
                </fieldset>
              </div>
            </section>

            <section className="form-section">
              <div className="form-section-intro">
                <h3>{t('projects.jiraTargets')}</h3>
                <p>{t('projects.jiraTargetsHint')}</p>
              </div>
              <div className="form-section-body">
                {project.targets.map((target) => {
                  const jiraProjects = jiraProjectsByConnection[target.connectionId] ?? []
                  const known = jiraProjects.find((p) => p.key === target.jiraProjectKey)
                  return (
                    <div key={target.id} className="row-card">
                      <div className="row-card-line">
                        <label className="grow">
                          <span className="visually-hidden">{t('settings.projectConnection')}</span>
                          <select
                            className={errorClass(!project.archived && !target.connectionId)}
                            value={target.connectionId}
                            onChange={(e) => {
                              patchTarget(project, target.id, { connectionId: e.target.value, jiraProjectKey: '' })
                              ensureJiraProjects(e.target.value)
                            }}
                          >
                            <option value="">—</option>
                            {config.connections.map((connection) => (
                              <option key={connection.id} value={connection.id}>
                                {connection.name || connection.jira.baseUrl}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="grow">
                          <span className="visually-hidden">{t('settings.projectJiraKey')}</span>
                          <input
                            className={`mono ${errorClass(!project.archived && !target.jiraProjectKey.trim()) ?? ''}`}
                            list={`jira-projects-${target.id}`}
                            value={target.jiraProjectKey}
                            placeholder={t('settings.projectJiraKey')}
                            spellCheck={false}
                            onFocus={() => ensureJiraProjects(target.connectionId)}
                            onChange={(e) => {
                              // The datalist option carries "KEY — name"; keep the key only.
                              const key = e.target.value.split('—')[0].trim().toUpperCase()
                              patchTarget(project, target.id, { jiraProjectKey: key })
                            }}
                          />
                          <datalist id={`jira-projects-${target.id}`}>
                            {jiraProjects.map((p) => (
                              <option key={p.id} value={p.key}>
                                {`${p.key} — ${p.name}`}
                              </option>
                            ))}
                          </datalist>
                        </label>
                        {known && <span className="row-card-status">{known.name}</span>}
                        {project.targets.length > 1 && (
                          <button
                            className="btn btn-ghost btn-icon btn-danger"
                            onClick={() => removeTarget(project, target.id)}
                            aria-label={t('projects.removeTarget')}
                            title={t('projects.removeTarget')}
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        )}
                      </div>
                      <label className="field">
                        <span>
                          {t('settings.projectInstruction')}
                          {project.targets.length > 1 && ` · ${connectionName(target.connectionId)}`}
                        </span>
                        <textarea
                          value={target.instruction}
                          placeholder={t('settings.projectInstructionPlaceholder')}
                          onChange={(e) => patchTarget(project, target.id, { instruction: e.target.value })}
                        />
                      </label>
                    </div>
                  )
                })}
                <button className="link" onClick={() => addTarget(project)}>
                  + {t('projects.addTarget')}
                </button>
              </div>
            </section>

            <section className="form-section">
              <div className="form-section-intro">
                <h3>{t('settings.projectFolder')}</h3>
                <p>{t('projects.foldersHint')}</p>
              </div>
              <div className="form-section-body">
                {project.gitFolders.map((folder, index) => (
                  <div key={`${folder.path}-${index}`} className="row-card">
                    <div className="row-card-line">
                      <Icon name="branch" />
                      <span className="grow mono row-card-path" title={folder.path}>
                        {folder.path}
                      </span>
                      <button className="btn btn-ghost btn-sm" onClick={() => changeFolder(project, index)}>
                        {t('projects.changeFolder')}
                      </button>
                      <button className="btn btn-ghost btn-sm btn-danger" onClick={() => removeFolder(project, index)}>
                        {t('projects.detachFolder')}
                      </button>
                    </div>
                    <div className="row-card-line">
                      <label className="grow inline-field">
                        <span className="muted">{t('projects.author')}</span>
                        <input
                          className={errorClass(!project.archived && !folder.includeAllAuthors && !folder.author.trim())}
                          value={folder.author}
                          placeholder={t('settings.gitAuthorEmail')}
                          disabled={folder.includeAllAuthors}
                          spellCheck={false}
                          onChange={(e) => patchFolder(project, index, { author: e.target.value.trim() })}
                        />
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={folder.includeAllAuthors}
                          onChange={(e) => patchFolder(project, index, { includeAllAuthors: e.target.checked })}
                        />
                        {t('settings.includeAllAuthors')}
                      </label>
                    </div>
                  </div>
                ))}
                <button className="link" onClick={() => addFolder(project)}>
                  + {t('projects.pickFolder')}
                </button>
              </div>
            </section>
          </>
        )}

        {(dirty || savedFlash || (saveBlocked && showBlockReason)) && (
          <div className="save-bar">
            {savedFlash && !dirty && <span className="save-bar-ok">{t('settings.saved')}</span>}
            {dirty && !(saveBlocked && showBlockReason) && (
              <span className="save-bar-dirty">
                <span className="dot dot-warning" />
                {t('settings.unsaved')}
              </span>
            )}
            {saveBlocked && showBlockReason && <span className="save-bar-blocked">{t('projects.invalidHint')}</span>}
            <span className="spacer" />
            {dirty && (
              <button className="btn btn-lg" onClick={discard}>
                {t('settings.discardChanges')}
              </button>
            )}
            <button
              className={`btn btn-primary btn-lg ${saveBlocked ? 'blocked' : ''}`}
              onClick={save}
              disabled={!dirty && !saveBlocked}
              title={saveBlocked ? t('projects.invalidHint') : undefined}
            >
              {t('app.save')}
            </button>
          </div>
        )}
      </main>

      {confirmDelete && (
        <Modal
          title={t('projects.deleteTitle')}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>
                {t('app.cancel')}
              </button>
              <span style={{ flex: 1 }} />
              <button className="btn" onClick={() => archiveFromDialog(confirmDelete)}>
                {t('projects.archiveInstead')}
              </button>
              <button className="btn btn-danger-solid" onClick={() => deleteProject(confirmDelete)}>
                {t('projects.deletePermanently')}
              </button>
            </>
          }
        >
          <p>
            <strong>
              {t('projects.deleteQuestion', {
                name: confirmDelete.name.trim() || t('projects.unnamed')
              })}
            </strong>
          </p>
          <p className="hint">{t('projects.deleteConsequence')}</p>
          <p className="hint">{t('projects.deleteArchiveAlt')}</p>
          <p className="banner banner-success">{t('projects.deleteTempoSafe')}</p>
        </Modal>
      )}
    </div>
  )
}
