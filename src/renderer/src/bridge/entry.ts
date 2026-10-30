import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { createTauriApi } from './tauriApi'
import type { RuntimeInfo } from './tauriApi'
import './backdrop.css'

async function start(): Promise<void> {
  const runtime = await invoke<RuntimeInfo>('runtime_info')
  window.api = createTauriApi()
  // External links (`openExternal` uses window.open) go to the system
  // browser, never into a new app window.
  window.open = ((url?: string | URL) => {
    if (url) void openUrl(String(url))
    return null
  }) as typeof window.open
  document.documentElement.dataset.backdrop = runtime.backdrop
  // The renderer bootstraps on import, so the bridge has to exist first.
  await import('@/main')
}

void start()
