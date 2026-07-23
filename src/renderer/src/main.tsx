import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initI18n } from './i18n'
import { useAppStore } from './store/appStore'
import { applyTheme } from './theme/themes'
import './styles/global.css'
import './styles/y2k.css'

async function bootstrap(): Promise<void> {
  const config = await window.api.config.get()
  initI18n(config.language)
  applyTheme(config.themeId)
  useAppStore.setState({ config })

  // Subscribe before fetching the current snapshot so no transition is missed.
  window.api.updates.onStateChange((state) => useAppStore.getState().setUpdate(state))
  void window.api.updates.getState().then((state) => useAppStore.getState().setUpdate(state))

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
