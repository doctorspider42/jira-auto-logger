---
name: run-and-debug
description: How to run, debug and manually test the Jira Auto Logger Tauri app - dev mode, mock mode with fake data, driving the window over DevTools, diagnostic logs and config locations. Use this whenever you need to start the app, reproduce a bug, verify a UI change, work without real Jira/Tempo credentials, or regenerate the README screenshots.
---

# Running and debugging Jira Auto Logger

## Commands

```bash
npm run dev          # Vite + the Rust backend in debug mode (real config and real APIs)
npm run dev:mock     # same on deterministic FAKE data - no tokens, no network
npm run typecheck    # tsc for vite.config.ts (tsconfig.node.json) and the renderer (tsconfig.web.json)
npm run test:rust    # cargo test for the backend
npm run build        # installer for this OS into src-tauri/target/release/bundle/
npx tauri build --no-bundle   # release exe only (src-tauri/target/release/jira-auto-logger.exe)
npm run screenshots  # README images from the release exe in mock mode (Windows)
```

Run `npm run typecheck` and `cargo build` (or `npm run test:rust`) before
committing - a clean build on both sides is the definition of done for a change.
The first Rust build takes several minutes; later ones are incremental.

## Mock mode - prefer it for UI work

`JAL_MOCK=1` (or `--mock` on the exe) swaps every external service for an
in-memory fake: two connections, three projects, six weeks of Tempo history,
fake commits and a fake LLM with a realistic delay. Implementation lives in
`src-tauri/src/mock/` (`data.rs` = fixtures, `clients.rs` = fake `JiraApi` /
`TempoApi` / `CommitSource`) and `src-tauri/src/llm/mock.rs`.

Two rules that keep mock mode healthy:
- Mock mode never reads or writes the real `config.json` (`ConfigService` short-circuits), and never sends telemetry, so it is always safe to run.
- When you add a field to `AppConfig`, update `mock_config()` in `src-tauri/src/mock/data.rs` too.

Data is seeded (mulberry32, same sequence as the old TypeScript fixtures), so
screenshots and manual tests are reproducible.

## Forcing a theme or backdrop at launch

`JAL_THEME=<id>` overrides the saved theme when the app boots (read in
`ConfigService::get`); an unknown id falls back to the default theme in
`applyTheme`. Valid ids come from `THEMES` in `src/renderer/src/theme/themes.ts`.
`maaSnEk` is `hidden` in that registry: reach it with `JAL_THEME=maaSnEk`, by
hand-editing `themeId`, or by typing `maasnek` on the Settings screen.

`JAL_BACKDROP=mica|acrylic|blur|none` forces the window effect (default: Mica
on Windows 11, Acrylic on Windows 10, vibrancy on macOS).

```bash
npx cross-env JAL_THEME=y2k npm run dev:mock     # any OS
```
```powershell
$env:JAL_THEME='y2k'; npm run dev:mock            # PowerShell (clear later: Remove-Item Env:JAL_THEME)
```

A theme can also change **wording** (`Theme.copy`, see the `architecture`
skill) - check both languages; `clairObscur` is the one that uses it today.

## Driving the window over DevTools

WebView2 exposes the Chrome DevTools Protocol when started with a debugging
port, which is how to test without clicking by hand:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'
src-tauri\target\release\jira-auto-logger.exe --mock
```

Then `http://127.0.0.1:9333/json` lists the page; connect to its
`webSocketDebuggerUrl` (Node 22+ has a global `WebSocket`) and use
`Runtime.evaluate` (e.g. `await window.api.llm.generateSuggestions(...)`) or
`Page.captureScreenshot`. The CDP capture shows the page only - the window
backdrop behind it is not in the image.

`npm run screenshots` (`scripts/screenshots.mjs`) does this for the README: it
starts the release exe in mock mode with `JAL_BACKDROP=none`, fixes the
viewport at 1280×820 and captures calendar, day view, both wizard steps,
projects, reports and settings into `screenshots/` (`JAL_SCREENSHOTS=<dir>`
for a scratch folder). Build first with `npx tauri build --no-bundle`. Clicks
on the calendar go through `Input.dispatchMouseEvent`, not synthetic DOM
events - a real cursor resting over the grid otherwise turns a click into a
drag across several days.

Reports land in the configured output folder (default `Documents/Jira Auto
Logger Reports`) even in mock mode - move test PDFs out afterwards.

## Where things live at runtime

- Config: `%APPDATA%/jira-auto-logger/config.json` (macOS `~/Library/Application Support/jira-auto-logger`, Linux `~/.config/jira-auto-logger`; path shown at the bottom of Settings). Tokens inside are encrypted (`secrets.rs`) with the key in `Local State` next to it - the same scheme the Electron builds used.
- Diagnostic log: `userData/logs/main.log` - every command with duration, git/CLI/LLM calls with sizes and exit codes, full errors. Read this first when someone reports "it failed". Never log secrets or full prompts there.
- Debug prompt preview: in the wizard (step 1) the `{ } Preview context` button shows the exact per-project prompt and a token estimate.

## Verifying a change end to end

1. `npm run dev:mock`, click a calendar day, generate suggestions, submit - created entries appear in the calendar (mock Tempo keeps them in memory).
2. For multi-day flows, drag across days and check the day tabs in step 2.
3. For real-API concerns (Jira search syntax, Tempo attributes), only `npm run dev` with real tokens can verify - mock Jira search is a simple substring filter.
