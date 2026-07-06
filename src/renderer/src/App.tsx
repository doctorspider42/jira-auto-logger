import { useTranslation } from 'react-i18next'
import { CalendarView } from './components/calendar/CalendarView'
import { ProjectsView } from './components/projects/ProjectsView'
import { SettingsView } from './components/settings/SettingsView'
import { useAppStore } from './store/appStore'
import type { AppView } from './store/appStore'

export default function App(): JSX.Element {
  const { t } = useTranslation()
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)

  const tabs: Array<{ id: AppView; label: string }> = [
    { id: 'calendar', label: t('app.calendar') },
    { id: 'projects', label: t('app.projects') },
    { id: 'settings', label: t('app.settings') }
  ]

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{t('app.title')}</h1>
        <nav className="nav-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`nav-tab ${view === tab.id ? 'active' : ''}`}
              onClick={() => setView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="app-main">
        {view === 'calendar' && <CalendarView key="calendar" />}
        {view === 'projects' && <ProjectsView key="projects" />}
        {view === 'settings' && <SettingsView key="settings" />}
      </main>
    </div>
  )
}
