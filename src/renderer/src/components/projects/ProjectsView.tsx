import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PROJECT_COLOR_PALETTE } from '@shared/domain'
import type { AppError, GitFolder, JiraProject, ProjectConfig, ProjectTarget } from '@shared/domain'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { useAppStore } from '@/store/appStore'
import './projects.css'

/**
 * Standalone project management view (main menu, next to the calendar).
 * A project pins one or more Jira projects (targets - e.g. the client's Jira
 * and the company Jira), optional repositories (each with its commit-author
 * filter) and a standing LLM instruction.
 */
export function ProjectsView(): JSX.Element {
  const { t } = useTranslation()
  const config = useAppStore((s) => s.config)
  const saveConfig = useAppStore((s) => s.saveConfig)

  const [projects, setProjects] = useState<ProjectConfig[]>(() => structuredClone(config.projects))
  const [jiraProjectsByConnection, setJiraProjectsByConnection] = useState<Record<string, JiraProject[]>>({})
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState<AppError | null>(null)

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
        { id: crypto.randomUUID(), connectionId: config.connections[0]?.id ?? '', jiraProjectKey: '' }
      ]
    })

  const removeTarget = (project: ProjectConfig, targetId: string): void =>
    patchProject(project.id, { targets: project.targets.filter((t) => t.id !== targetId) })

  const addProject = (): void =>
    setProjects((all) => [
      ...all,
      {
        id: crypto.randomUUID(),
        name: '',
        targets: [
          {
            id: crypto.randomUUID(),
            connectionId: config.connections[0]?.id ?? '',
            jiraProjectKey: ''
          }
        ],
        gitFolders: [],
        instruction: '',
        color: PROJECT_COLOR_PALETTE[projects.length % PROJECT_COLOR_PALETTE.length]
      }
    ])

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

  /** Name and at least one complete target are required; a repo needs an author. */
  const invalidProjects = projects.filter(
    (p) =>
      !p.name.trim() ||
      p.targets.length === 0 ||
      p.targets.some((target) => !target.connectionId || !target.jiraProjectKey.trim()) ||
      p.gitFolders.some((f) => !f.includeAllAuthors && !f.author.trim())
  )

  const save = async (): Promise<void> => {
    setError(null)
    const result = await saveConfig({ ...config, projects })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2500)
  }

  return (
    <div className="projects-view">
      {error && <ErrorBanner error={error} />}
      <p className="hint">{t('projects.hint')}</p>

      {config.connections.length === 0 && <p className="hint">{t('projects.noConnections')}</p>}

      {projects.map((project) => {
        const invalid = invalidProjects.includes(project)
        return (
          <div key={project.id} className={`card projects-card ${invalid ? 'invalid' : ''}`}>
            <div className="field-row">
              <div className="field projects-color-field">
                <label>{t('projects.color')}</label>
                <input
                  type="color"
                  value={project.color || '#6d9eff'}
                  title={t('projects.colorHint')}
                  onChange={(e) => patchProject(project.id, { color: e.target.value })}
                />
              </div>
              <div className="field">
                <label>{t('settings.projectName')}</label>
                <input
                  value={project.name}
                  placeholder={t('settings.projectNamePlaceholder')}
                  onChange={(e) => patchProject(project.id, { name: e.target.value })}
                />
              </div>
            </div>

            <div className="field">
              <label>{t('projects.jiraTargets')}</label>
              <p className="hint projects-targets-hint">{t('projects.jiraTargetsHint')}</p>
              {project.targets.map((target) => {
                const jiraProjects = jiraProjectsByConnection[target.connectionId] ?? []
                return (
                  <div key={target.id} className="field-row projects-target-row">
                    <div className="field">
                      <label>{t('settings.projectConnection')}</label>
                      <select
                        value={target.connectionId}
                        onChange={(e) => {
                          patchTarget(project, target.id, {
                            connectionId: e.target.value,
                            jiraProjectKey: ''
                          })
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
                    </div>
                    <div className="field">
                      <label>{t('settings.projectJiraKey')}</label>
                      <input
                        list={`jira-projects-${target.id}`}
                        value={target.jiraProjectKey}
                        placeholder="PROJ"
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
                    </div>
                    {project.targets.length > 1 && (
                      <button
                        className="btn btn-ghost btn-sm btn-danger projects-target-remove"
                        onClick={() => removeTarget(project, target.id)}
                      >
                        {t('projects.removeTarget')}
                      </button>
                    )}
                  </div>
                )
              })}
              <div>
                <button className="btn btn-sm" onClick={() => addTarget(project)}>
                  + {t('projects.addTarget')}
                </button>
              </div>
            </div>

            <div className="field">
              <label>{t('settings.projectFolder')}</label>
              {project.gitFolders.map((folder, index) => (
                <div key={`${folder.path}-${index}`} className="projects-folder">
                  <div className="projects-folder-head">
                    <span className="projects-folder-path" title={folder.path}>
                      {folder.path}
                    </span>
                    <button className="btn btn-sm" onClick={() => changeFolder(project, index)}>
                      {t('projects.changeFolder')}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() => removeFolder(project, index)}
                    >
                      {t('projects.detachFolder')}
                    </button>
                  </div>
                  <div className="settings-folder-author">
                    <input
                      value={folder.author}
                      placeholder={t('settings.gitAuthorEmail')}
                      aria-label={t('settings.gitAuthorEmail')}
                      disabled={folder.includeAllAuthors}
                      spellCheck={false}
                      onChange={(e) => patchFolder(project, index, { author: e.target.value.trim() })}
                    />
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={folder.includeAllAuthors}
                        onChange={(e) =>
                          patchFolder(project, index, { includeAllAuthors: e.target.checked })
                        }
                      />
                      {t('settings.includeAllAuthors')}
                    </label>
                  </div>
                </div>
              ))}
              <div>
                <button className="btn" onClick={() => addFolder(project)}>
                  + {t('projects.pickFolder')}
                </button>
              </div>
            </div>

            <div className="field">
              <label>{t('settings.projectInstruction')}</label>
              <textarea
                value={project.instruction}
                placeholder={t('settings.projectInstructionPlaceholder')}
                onChange={(e) => patchProject(project.id, { instruction: e.target.value })}
              />
            </div>

            <div className="settings-test-row">
              <span style={{ flex: 1 }} />
              <button
                className="btn btn-ghost btn-sm btn-danger"
                onClick={() => setProjects((all) => all.filter((p) => p.id !== project.id))}
              >
                {t('settings.removeProject')}
              </button>
            </div>
          </div>
        )
      })}

      <button className="btn" onClick={addProject} disabled={config.connections.length === 0}>
        + {t('settings.addProject')}
      </button>

      {invalidProjects.length > 0 && (
        <p className="hint settings-folder-warning">{t('projects.invalidHint')}</p>
      )}

      <div className="settings-save-bar">
        {savedFlash && !dirty && <span className="settings-test-ok">✓ {t('settings.saved')}</span>}
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={!dirty || invalidProjects.length > 0}
          title={invalidProjects.length > 0 ? t('projects.invalidHint') : undefined}
        >
          {t('app.save')}
        </button>
      </div>
    </div>
  )
}
