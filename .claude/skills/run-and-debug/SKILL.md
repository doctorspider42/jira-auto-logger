---
name: run-and-debug
description: How to run, debug and manually test the Jira Auto Logger Electron app - dev mode, mock mode with fake data, screenshot automation, diagnostic logs and config locations. Use this whenever you need to start the app, reproduce a bug, verify a UI change, work without real Jira/Tempo credentials, or regenerate the README screenshots.
---

# Running and debugging Jira Auto Logger

## Commands

```bash
npm run dev          # dev mode with HMR (real config and real APIs)
npm run dev:mock     # dev mode on deterministic FAKE data - no tokens, no network
npm run screenshots  # mock mode + automated UI drive, refreshes screenshots/*.png, then quits
npm run typecheck    # tsc for main+preload (tsconfig.node.json) and renderer (tsconfig.web.json)
npm run build        # production bundles into out/
npm run dist:win     # local installer (also dist:mac, dist:linux)
```

Always run `npm run typecheck` (and usually `npm run build`) before committing - this repo treats a clean typecheck as the definition of done for a change.

## Mock mode - prefer it for UI work

`JAL_MOCK=1` (or `--mock`) swaps every external service for an in-memory fake:
two connections, three projects, six weeks of Tempo history, fake commits and a
fake LLM with a realistic delay. Implementation lives in
`src/main/services/mock/` (`data.ts` = fixtures, `clients.ts` = fake
implementations of the `JiraApi`/`TempoApi`/`CommitSource`/`LlmProvider`
interfaces).

Two rules that keep mock mode healthy:
- Mock mode never reads or writes the real `config.json` (`ConfigService` short-circuits), so it is always safe to run.
- When you add a field to `AppConfig`, update `mockConfig()` in `src/main/services/mock/data.ts` too, or mock mode stops compiling - that is intentional, it keeps the fixtures honest.

Data is seeded (mulberry32), so screenshots and manual tests are reproducible.

## Forcing a theme at launch

`JAL_THEME=<id>` overrides the saved theme when the app boots, so you can test a
theme without clicking through Settings. It is read once in `ConfigService.get()`
and applied to whatever config was loaded (mock or real); an unknown id falls
back to the default theme in `applyTheme`, so typos degrade gracefully.

Valid ids come from `THEMES` in `src/renderer/src/theme/themes.ts`: `dark`,
`light`, `win95`, `fallout`, `falloutNV`, `helloKitty`, `y2k`.

Prefer mock mode — it never persists, so a forced theme can't leak into your
real `config.json` even if you hit Save in Settings. `cross-env` (already a dev
dependency) makes it cross-platform:

```bash
npx cross-env JAL_THEME=y2k npm run dev:mock     # any OS
```

Native shells work too:

```bash
JAL_THEME=y2k npm run dev:mock                    # bash / zsh
```
```powershell
$env:JAL_THEME='y2k'; npm run dev:mock            # PowerShell (clear later: Remove-Item Env:JAL_THEME)
```

It composes with the screenshot driver as well
(`npx cross-env JAL_THEME=y2k npm run screenshots`) if you want theme-specific
captures.

## Screenshot automation

`npm run screenshots` drives the UI from the main process
(`src/main/screenshotMode.ts`): captures calendar, projects, settings, then
opens the wizard, selects projects, generates suggestions with the mock LLM and
captures both wizard steps. The README embeds these images - regenerate them
after visible UI changes and commit the PNGs.

Gotcha encoded in that file: simulated `mousedown`/`mouseup` must be separated
by a pause, because the calendar attaches its `mouseup` listener in a React
effect after the `mousedown` re-render.

## Where things live at runtime

- Config: `%APPDATA%/jira-auto-logger/config.json` (userData dir; path shown at the bottom of the Settings tab). API tokens inside are encrypted via `safeStorage`.
- Diagnostic log: `userData/logs/main.log` - every IPC call with duration, git/CLI/LLM calls with sizes and exit codes, full errors with stack traces. Read this first when someone reports "it failed". Never log secrets or full prompts there.
- Debug prompt preview: in the wizard (step 1) the `{ } Preview context` button shows the exact per-project prompt and a token estimate - useful to verify what the LLM actually receives.

## Verifying a change end to end

1. `npm run dev:mock`, click a calendar day, generate suggestions, submit - created entries appear in the calendar (mock Tempo keeps them in memory).
2. For multi-day flows, drag across days and check the day tabs in step 2.
3. For real-API concerns (Jira search syntax, Tempo attributes), only `npm run dev` with real tokens can verify - mock Jira search is a simple substring filter.
