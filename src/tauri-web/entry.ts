import { invoke } from '@tauri-apps/api/core'
import { createTauriApi } from './tauriApi'
import type { RuntimeInfo } from './tauriApi'
import './backdrop.css'

async function start(): Promise<void> {
  const runtime = await invoke<RuntimeInfo>('runtime_info')
  window.api = createTauriApi(runtime)
  document.documentElement.dataset.backdrop = runtime.backdrop
  // The renderer bootstraps on import, so the bridge has to exist first.
  await import('@/main')
}

void start()
