import { useTranslation } from 'react-i18next'
import { CalendarView } from './components/calendar/CalendarView'
import { ProjectsView } from './components/projects/ProjectsView'
import { SettingsView } from './components/settings/SettingsView'
import { ReportReminderBanner } from './components/reports/ReportReminderBanner'
import { ReportsView } from './components/reports/ReportsView'
import { UpdateBanner } from './components/common/UpdateBanner'
import { useAppStore, UPDATE_NOTIFYING_STATUSES } from './store/appStore'
import type { AppView } from './store/appStore'

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

  const tabs: Array<{ id: AppView; label: string; badge?: boolean }> = [
    { id: 'calendar', label: t('app.calendar') },
    { id: 'projects', label: t('app.projects') },
    { id: 'reports', label: t('app.reports') },
    { id: 'settings', label: t('app.settings'), badge: updateAvailable }
  ]

  return (
    <div className="app-shell">
      <header className="app-header">
        {/* The version sits next to the title but outside the <h1>: themes
            paint the heading itself (y2k clips a gradient to the text, ps1 adds
            an ::after glyph row), and a nested span would inherit that. */}
        <div className="app-title">
          <h1>{t('app.title')}</h1>
          {currentVersion && (
            <span className="app-version" title={t('app.versionTitle')}>
              v{currentVersion}
            </span>
          )}
        </div>
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
        <ReportReminderBanner />
        {view === 'calendar' && <CalendarView key="calendar" />}
        {view === 'projects' && <ProjectsView key="projects" />}
        {view === 'reports' && <ReportsView key="reports" />}
        {view === 'settings' && <SettingsView key="settings" />}
      </main>
    </div>
  )
}
