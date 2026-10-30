import { useTranslation } from 'react-i18next'
import { CalendarView } from './components/calendar/CalendarView'
import { ProjectsView } from './components/projects/ProjectsView'
import { SettingsView } from './components/settings/SettingsView'
import { ReportReminderBanner } from './components/reports/ReportReminderBanner'
import { ReportsView } from './components/reports/ReportsView'
import { UpdateBanner } from './components/common/UpdateBanner'
import { useAppStore, UPDATE_NOTIFYING_STATUSES } from './store/appStore'
import type { AppView } from './store/appStore'
import { Icon } from './components/common/Icon'
import type { IconName } from './components/common/Icon'

export default function App(): JSX.Element {
  const { t } = useTranslation()
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const updateStatus = useAppStore((s) => s.update?.status)
  const updateAvailable = !!updateStatus && UPDATE_NOTIFYING_STATUSES.has(updateStatus)
  // The updater snapshot carries the running version (app.getVersion()) and is
  // fetched during bootstrap, so this is filled in dev and mock mode too - even
  // though update *checks* are disabled there.
  const currentVersion = useAppStore((s) => s.update?.currentVersion)

  const tabs: Array<{ id: AppView; label: string; icon: IconName; badge?: boolean }> = [
    { id: 'calendar', label: t('app.calendar'), icon: 'calendar' },
    { id: 'projects', label: t('app.projects'), icon: 'projects' },
    { id: 'reports', label: t('app.reports'), icon: 'reports' },
    { id: 'settings', label: t('app.settings'), icon: 'settings', badge: updateAvailable }
  ]

  return (
    <div className="app-shell">
      <aside className="app-rail">
        <nav className="app-nav" aria-label={t('app.title')}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`app-nav-item ${view === tab.id ? 'active' : ''}`}
              aria-current={view === tab.id ? 'page' : undefined}
              onClick={() => setView(tab.id)}
            >
              <Icon name={tab.icon} size={18} />
              {tab.label}
              {tab.badge && <span className="app-nav-badge" title={t('updates.badgeTitle')} />}
            </button>
          ))}
        </nav>
        {currentVersion && (
          <span className="app-version" title={t('app.versionTitle')}>
            {currentVersion}
          </span>
        )}
      </aside>
      <main className="app-main">
        <UpdateBanner />
        <ReportReminderBanner />
        {view === 'calendar' && <CalendarView key="calendar" />}
        {view === 'projects' && <ProjectsView key="projects" />}
        {view === 'reports' && <ReportsView key="reports" />}
        {view === 'settings' && <SettingsView key="settings" />}
      </main>
    </div>
  )
}
