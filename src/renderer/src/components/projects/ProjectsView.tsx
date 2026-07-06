import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PROJECT_COLOR_PALETTE } from '@shared/domain'
import type { AppError, JiraProject, ProjectConfig } from '@shared/domain'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { useAppStore } from '@/store/appStore'
import './projects.css'

/**
 * Standalone project management view (main menu, next to the calendar).
 * A project pins a Jira project of one connection, an optional repository
 * (picked directly here, with its commit-author filter) and a standing LLM
 * instruction.
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

  const addProject = (): void =>
    setProjects((all) => [
      ...all,
      {
        id: crypto.randomUUID(),
        name: '',
        connectionId: config.connections[0]?.id ?? '',
        jiraProjectKey: '',
        gitFolder: null,
        instruction: '',
        color: PROJECT_COLOR_PALETTE[projects.length % PROJECT_COLOR_PALETTE.length]
      }
    ])

  const pickFolder = async (project: ProjectConfig): Promise<void> => {
    const path = await window.api.dialog.pickFolder()
    if (!path) return
    const label = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
    patchProject(project.id, {
      gitFolder: { path, label, author: project.gitFolder?.author ?? '', includeAllAuthors: false }
    })
  }

  /** Name, connection and Jira project are required; a repo needs an author. */
  const invalidProjects = projects.filter(
    (p) =>
      !p.name.trim() ||
      !p.connectionId ||
      !p.jiraProjectKey.trim() ||
      (p.gitFolder !== null && !p.gitFolder.includeAllAuthors && !p.gitFolder.author.trim())
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
        const jiraProjects = jiraProjectsByConnection[project.connectionId] ?? []
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
              <div className="field">
                <label>{t('settings.projectConnection')}</label>
                <select
                  value={project.connectionId}
                  onChange={(e) => {
                    patchProject(project.id, { connectionId: e.target.value, jiraProjectKey: '' })
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
                  list={`jira-projects-${project.id}`}
                  value={project.jiraProjectKey}
                  placeholder="PROJ"
                  spellCheck={false}
                  onFocus={() => ensureJiraProjects(project.connectionId)}
                  onChange={(e) => {
                    // The datalist option carries "KEY — name"; keep the key only.
                    const key = e.target.value.split('—')[0].trim().toUpperCase()
                    patchProject(project.id, { jiraProjectKey: key })
                  }}
                />
                <datalist id={`jira-projects-${project.id}`}>
                  {jiraProjects.map((p) => (
                    <option key={p.id} value={p.key}>
                      {`${p.key} — ${p.name}`}
                    </option>
                  ))}
                </datalist>
              </div>
            </div>

            <div className="field">
              <label>{t('settings.projectFolder')}</label>
              {project.gitFolder ? (
                <div className="projects-folder">
                  <div className="projects-folder-head">
                    <span className="projects-folder-path" title={project.gitFolder.path}>
                      {project.gitFolder.path}
                    </span>
                    <button className="btn btn-sm" onClick={() => pickFolder(project)}>
                      {t('projects.changeFolder')}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() => patchProject(project.id, { gitFolder: null })}
                    >
                      {t('projects.detachFolder')}
                    </button>
                  </div>
                  <div className="settings-folder-author">
                    <input
                      value={project.gitFolder.author}
                      placeholder={t('settings.gitAuthorEmail')}
                      aria-label={t('settings.gitAuthorEmail')}
                      disabled={project.gitFolder.includeAllAuthors}
                      spellCheck={false}
                      onChange={(e) =>
                        patchProject(project.id, {
                          gitFolder: { ...project.gitFolder!, author: e.target.value.trim() }
                        })
                      }
                    />
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={project.gitFolder.includeAllAuthors}
                        onChange={(e) =>
                          patchProject(project.id, {
                            gitFolder: { ...project.gitFolder!, includeAllAuthors: e.target.checked }
                          })
                        }
                      />
                      {t('settings.includeAllAuthors')}
                    </label>
                  </div>
                </div>
              ) : (
                <div>
                  <button className="btn" onClick={() => pickFolder(project)}>
                    {t('projects.pickFolder')}
                  </button>
                </div>
              )}
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
