# Moving to Tauri and the new designs

Working branch: `tauri-redesign`. Electron keeps shipping from `main` until this branch
replaces it in one release. Creating Jira issues comes after the switch.

The renderer keeps talking to the backend through the same `IpcApi` contract
(`src/shared/ipc.ts`); only its implementation moves from the Electron main process to
Rust commands. That keeps the port and the redesign independent of each other.

## 1. Rust foundation
- [ ] Domain types in Rust (serde, camelCase) mirroring `src/shared/domain.ts`
- [ ] `AppError` with the same codes, commands return the same `Result` shape
- [ ] Config: full `ConfigService.load()` port with migrations; saving with the
      same `safeStorage` encryption, so Electron and Tauri can read each other's file
- [ ] File logger at the same path (`userData/logs/main.log`)
- [ ] Mock mode (`--mock`, `JAL_MOCK=1`) with the same data
- [ ] `window.api` bridge: one Tauri command per IPC channel, events for pushes

## 2. Services
- [ ] Jira client, Tempo client, connection manager
- [ ] Git commits
- [ ] LLM: CLI runner, Claude / Copilot / OpenAI providers, prompt building,
      `parseSuggestions` validation, Claude login flow
- [ ] PDF reports (HTML template printed to PDF)
- [ ] Auto logger scheduler and notifications
- [ ] Updates (Tauri updater, signed) and release history
- [ ] Telemetry (Aptabase, same events and gates)

## 3. Desktop integration
- [ ] Single instance, tray, minimize to tray, launch at login (`--hidden`)
- [ ] External links in the system browser, folder picker, reveal in folder
- [ ] Window backdrop (Mica / Acrylic / vibrancy)

## 4. Switch
- [ ] Release workflow builds Tauri bundles for Windows, macOS, Linux
- [ ] Updater signing key in GitHub secrets (manual step)
- [ ] Last Electron release points existing users to the Tauri installer
- [ ] Remove Electron, electron-vite, electron-builder

## 5. Redesign (`docs/redesign`)
- [ ] Theme system: six colour tokens, type, shape, texture, voice; 12 themes
- [ ] App shell with the side menu
- [ ] Calendar month and day views
- [ ] New entries: context and review steps
- [ ] Projects, reports, settings
- [ ] README screenshots
