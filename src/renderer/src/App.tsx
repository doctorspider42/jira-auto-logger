import { useTranslation } from 'react-i18next'
import { CalendarView } from './components/calendar/CalendarView'
import { ProjectsView } from './components/projects/ProjectsView'
import { SettingsView } from './components/settings/SettingsView'
import { UpdateBanner } from './components/common/UpdateBanner'
import { useAppStore, UPDATE_NOTIFYING_STATUSES } from './store/appStore'
import type { AppView } from './store/appStore'

export default function App(): JSX.Element {
  const { t } = useTranslation()
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const updateStatus = useAppStore((s) => s.update?.status)
  const updateAvailable = !!updateStatus && UPDATE_NOTIFYING_STATUSES.has(updateStatus)

  const tabs: Array<{ id: AppView; label: string; badge?: boolean }> = [
    { id: 'calendar', label: t('app.calendar') },
    { id: 'projects', label: t('app.projects') },
    { id: 'settings', label: t('app.settings'), badge: updateAvailable }
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
              {tab.badge && <span className="nav-tab-badge" title={t('updates.badgeTitle')} />}
            </button>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <UpdateBanner />
        {view === 'calendar' && <CalendarView key="calendar" />}
        {view === 'projects' && <ProjectsView key="projects" />}
        {view === 'settings' && <SettingsView key="settings" />}
      </main>
    </div>
  )
}
