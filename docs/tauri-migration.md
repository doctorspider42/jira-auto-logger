# Moving to Tauri and the new designs

Working branch: `tauri-redesign`. Electron keeps shipping from `main` until this branch
replaces it in one release (0.2.0). Creating Jira issues comes after the switch.

The renderer talks to the backend through the same `IpcApi` contract
(`src/shared/ipc.ts`); its implementation moved from the Electron main process to
Rust commands.

## 1. Rust foundation
- [x] Domain types in Rust (serde, camelCase) mirroring `src/shared/domain.ts`
- [x] `AppError` with the same codes, commands return the same `Result` shape
- [x] Config: full `ConfigService.load()` port with migrations; saving with the
      same `safeStorage` encryption, so Electron and Tauri read each other's file
- [x] File logger at the same path (`userData/logs/main.log`)
- [x] Mock mode (`--mock`, `JAL_MOCK=1`) with the same data
- [x] `window.api` bridge: one Tauri command per IPC channel, events for pushes

## 2. Services
- [x] Jira client, Tempo client, connection manager
- [x] Git commits
- [x] LLM: CLI runner, Claude / Copilot / OpenAI providers, prompt building,
      response validation, Claude login flow
- [x] PDF reports on Windows (report HTML printed by WebView2)
- [ ] PDF reports on macOS (WKWebView) and Linux (WebKitGTK)
- [x] Auto logger scheduler and notifications
- [x] Updates (Tauri updater, signed) and release history
- [x] Telemetry (Aptabase HTTP API, same events and gates)

## 3. Desktop integration
- [x] Single instance, tray, minimize to tray, launch at login (`--hidden`)
- [x] External links in the system browser, folder picker, reveal in folder
- [x] Window backdrop (Mica / Acrylic / vibrancy)
- [ ] Token encryption on macOS (Keychain) and Linux (libsecret); until then
      tokens stay in the config file there, as Electron did without a keychain

## 4. Switch
- [x] Release workflow builds Tauri bundles for Windows, macOS, Linux
- [ ] Updater signing key in GitHub secrets (`TAURI_SIGNING_PRIVATE_KEY`) - manual step
- [x] Electron update feeds point existing installs at the Tauri installer;
      the NSIS hook removes the old Electron copy
- [x] Remove Electron, electron-vite, electron-builder

## 5. Redesign (`docs/redesign`)
- [x] Theme system: tokens for palette, type, shape, texture, voice; 12 themes
- [x] App shell with the side menu
- [x] Calendar month view (summary, progress bars, selected-day panel) and day view (lane per Jira)
- [x] New entries: context and review steps
- [x] Projects as list + editor
- [~] Settings and Reports restyled with the new tokens and navigation; the
      design's collapsible connection rows and Reports' new builder layout are not built
- [x] README screenshots (`npm run screenshots`)
