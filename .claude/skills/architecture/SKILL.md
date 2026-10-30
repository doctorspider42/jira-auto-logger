---
name: architecture
description: Code map and conventions of the Jira Auto Logger Tauri app - Rust backend, typed command contract, domain model, LLM pipeline, config migrations, i18n and theming rules. Use this before adding any feature, changing the config shape, adding a backend command, touching the LLM prompt, or modifying Jira/Tempo integration - it contains the checklists that keep changes consistent.
---

# Architecture and conventions

## Layers

```
src-tauri/         Rust backend: all logic. The renderer never calls external APIs.
src/shared/        renderer-side domain types (domain.ts) + the command contract (ipc.ts).
src/renderer/      React UI: zustand store (store/appStore.ts), i18next, CSS-variable themes.
  src/bridge/      `window.api` (IpcApi) implemented with Tauri `invoke`/`listen`.
```

Rust modules (`src-tauri/src/`):
- `domain.rs` - serde mirror of `src/shared/domain.ts`, camelCase on the wire. **Change both files together**; nothing checks them against each other.
- `commands.rs` - one `#[tauri::command]` per `IpcApi` method, named after its channel (`jira:getProjects` -> `jira_get_projects`); fallible ones wrap their work in `to_result(channel, future)`, which logs duration and errors and returns the `{ ok, value } | { ok, error }` envelope.
- `config.rs` - `ConfigService`: config JSON in the userData folder (`paths.rs`, the same folder the Electron builds used); **all shape migrations live in `migrate()`**, working on raw JSON before it is deserialized. Tokens are encrypted by `secrets.rs`, compatible with Electron's `safeStorage` (Chromium OSCrypt on Windows), so old and new builds read each other's file.
- `services/` - `ConnectionManager` (connectionId -> cached `JiraApi`/`TempoApi` clients, or mocks; caches the accountId), `jira.rs`, `tempo.rs`, `git.rs` behind the traits `JiraApi`, `TempoApi`, `CommitSource`.
- `llm/` - `LlmService` orchestration; providers (`ClaudeCli`, `CopilotCli`, `OpenAiApi`, mock) implement `LlmProvider` and only turn a prompt into text.
- `reports/` - report HTML (`html.rs`) printed to PDF by the system webview (`pdf.rs`; WebView2 on Windows, not implemented on macOS/Linux yet).
- `auto_logger.rs`, `updates.rs` (Tauri updater + GitHub API), `telemetry.rs` (Aptabase HTTP API), `desktop.rs` (tray, launch at login, window behaviour, backdrop), `logger.rs` (`userData/logs/main.log`).
- `mock/` - deterministic fake data and clients for mock mode.

## Domain model in one breath

`JiraConnection` (Jira instance + Tempo token) → `ProjectConfig` (name, one or
more `targets` - each a Jira project of one connection with its own standing
LLM instruction, e.g. the client's Jira and the company Jira - `gitFolders`
with per-repo author filter, calendar color) → the wizard generates **one
isolated LLM pass per target of every selected project** (only that target's
issues, its instruction, Tempo style
examples, the project's commits and note go into the context; hours are NOT
split between targets - each Jira gets full, independent entries).
`CustomFieldConfig` maps Tempo work attributes (bool/string) per connection;
values can be LLM-filled and can mark calendar entries with an icon.

## Checklists

**Adding a backend command** (typecheck and `cargo build` catch most misses):
1. Types in `src/shared/domain.ts` **and** `src-tauri/src/domain.rs`.
2. Method on `IpcApi` + channel constant in `src/shared/ipc.ts`.
3. `#[tauri::command]` in `src-tauri/src/commands.rs`, wrapped in `to_result`, and listed in `generate_handler!` in `main.rs`.
4. The method in `src/renderer/src/bridge/tauriApi.ts` (`invoke('<command>', { camelCaseArgs })`).
5. Renderer calls `window.api.*` and branches on `Result` (`result.ok`).

Backend pushes (update state, auto logger prompts) are Tauri events named like
the old IPC channels (`updates:stateChange`); the bridge subscribes with `listen`.

**Errors**: return `AppError::new(ErrorCode::…, message)` (or `with_details`)
from Rust; the renderer translates the `code` via `errors.*` i18n keys
(`ErrorBanner`). A new code goes into `ErrorCode` (error.rs), `AppErrorCode`
(domain.ts) and both locale files.

**Adding a config field**:
1. `AppConfig` in domain.ts and domain.rs (`#[serde(default)]` keeps old files loading),
2. default in `default_config_value()` (config.rs),
3. migration/normalization in `migrate()` if old files need mapping,
4. `mock_config()` in `src-tauri/src/mock/data.rs`, 5. settings UI + i18n.

**i18n**: every user-visible string goes through `t()`; add keys to **both**
`src/renderer/src/i18n/pl.json` and `en.json` in the same change. Some strings
are also **reworded per theme** (`themeCopy.*`, see Themes below) - before
renaming or removing a key, grep for it under `themeCopy`: nothing typechecks
i18n key strings, so a rename silently orphans the theme's version and the UI
quietly falls back to the default wording. The few backend strings (tray menu,
notifications, report labels) are chosen by `config.language` in Rust.

**Themes**: colors, radii, fonts and shadows are CSS variables defined per
theme in `src/renderer/src/theme/themes.ts`. Never hardcode a color in
component CSS - use the variables (or `color-mix` on them) so every theme in
`THEMES` keeps working.

The character themes also have an effects stylesheet in
`src/renderer/src/styles/themes/` (imported in `main.tsx`), every rule scoped
under `[data-theme='<id>']`: PS1's CRT glass and bevels, Clair Obscur's petals
and journal numerals, Animus's fog and rising formulas, Y2K's chrome, the
maa-sn-ek banner, Classic 95 title bars and the Fallout glow. They hook the
shared class names (`.app-rail`, `.app-nav-item`, `.page-title`, `.card`,
`.inspector`, `.segmented`, `.calendar-day`, `.wizard-screen`...), so **renaming
one of those means grepping `styles/themes/` too**. Rules for those files:
- Never change layout (sizes, grid templates, padding that moves content) -
  only paint. The exception is making room for a theme's own fixture (the
  maa-sn-ek plank shortens `.app-shell`).
- Anything that moves continuously runs on its own `position: fixed` layer
  animated by `transform`, never by `background-position`: the latter repaints
  the whole window every frame. Layers behind the UI use `z-index: 0` (under
  `#root`), overlays (scanlines, petals) a z-index above the modal layer and
  `pointer-events: none`.
- Every animation stops under `prefers-reduced-motion`.
- A theme that paints its own window canvas sets `canvas: true` in `THEMES`,
  which keeps the window opaque under Mica/Acrylic (`bridge/backdrop.css`), and
  paints `.wizard-screen` with the same canvas (it covers the window).
- Inline tokens beat stylesheet variables, so a theme file can't override
  `--font-display` and friends - give its own values their own names.

**A theme can also reword the UI, not just recolour it** - assume any label may
be themed and keep new UI open to it. The mechanism is `Theme.copy`, resolved by
`src/renderer/src/theme/useThemeCopy.ts`. The strings themselves stay in the
locale files under `themeCopy.<themeId>` (a theme must never hardcode language);
the theme entry only points at that subtree and says how it combines:
- **A single label**: put it at the same path inside the subtree
  (`themeCopy.clairObscur.wizard.submit` overrides `wizard.submit`) and render it
  with `useThemeText()`'s `tt()` instead of `t()`. `tt()` tries the theme's key
  first and falls back to the root one, so themes without the subtree - and
  labels no theme rewords - behave exactly as before. Interpolation and `count`
  work the same, so keep the placeholders (`{{count}}`) in the themed string.
- **Loading messages** (`FunnyLoader`): add a `funnyLoading` array to the subtree
  and set `copy.loadingMessages` to `'extend'` (its messages join the shared
  pool) or `'replace'` (only its own). Consumed via `useLoadingMessages()`.

Which is which today: `clairObscur` replaces the loading messages and reads
"We Continue" / "Przemy naprzód" on the wizard's log-time button; no other theme
declares `copy`.

When adding UI, prefer `tt()` for the few labels that carry an app's *voice*
(headline actions, empty states, loaders) and plain `t()` for everything factual
(field labels, errors, numbers) - a theme rewording "Save" is character, a theme
rewording an error message is a support ticket. Themed copy is optional
flavour: the app must read correctly with none of it.

**User-facing changes**: if a change is something a user would notice, add a
`CHANGELOG.md` entry in the same commit - it feeds the in-app "What's new" /
version history view and the GitHub release notes. Every push to `main`
releases, so the note ships with the change. See the `release` skill for the
exact format and how the version number is chosen.

## LLM pipeline specifics

- The main prompt is **baked into the app** (`src-tauri/src/llm/main_prompt.txt`, included at compile time), not stored in config - editing it takes effect for everyone on the next release. The user can only append free-form guidance via `llm.additionalInstructions`, which `LlmService` injects at the `{{additionalInstructions}}` placeholder as a highest-priority override.
- Placeholders substituted by `LlmService`: `{{input}}` (compact JSON), `{{workingHoursPerDay}}`, `{{language}}`, `{{additionalInstructions}}`. The input also carries the per-date `hoursAlreadyLogged` so suggestions top a day up to `workingHoursPerDay` instead of re-logging existing entries.
- Token discipline: input JSON is compact (no pretty-print; `serde_json` keeps insertion order via `preserve_order`, and numbers print like JavaScript via `js_number`), long fields are clipped, and per-project passes deliberately exclude other projects. Keep it that way.
- LLM output is never trusted: `parse_suggestions` validates issue keys against the real candidate pool, normalizes hours and custom-field types; `extract_json_array` tolerates prose and fences around the answer (unit tests in `llm/mod.rs`).
- Providers run sequentially across projects (CLI backends dislike concurrency). CLIs are resolved with `which` so npm's `.cmd` shims run on Windows.

## Telemetry (Aptabase)

Anonymous, opt-out usage telemetry lives in `src-tauri/src/telemetry.rs`, which
posts events to Aptabase's HTTP API directly (no SDK). Aptabase attributes
sessions, app version and OS from the system props; we add only coarse events:
`app_started` (with `theme`), `worklogs_created` (count, hours) and a bare
`report_generated`.

Hard rules:
- The opt-out (`config.telemetry.enabled`) and the mock-mode gate are checked
  per event in `track()`, so the setting takes effect with no restart.
- Never send content: no issue keys, descriptions, credentials, paths, notes.
  Only counts, durations, enums.
- **Mock mode never phones home** (`paths::is_mock_mode()` gate +
  `telemetry.enabled: false` in `mock_config()`). Keep both.
- Sending is spawned off the caller's path and its failure only logs: telemetry
  must never affect the app.

**Adding a new event**: add a `track_foo()` function in `telemetry.rs` that calls
`track()` (so it inherits gating + the `env` prop), then call it from the backend
site where the action succeeded (e.g. a command, after the work).

**Event props vs session attributes**: Aptabase has **no** user/session-property
API - custom values can only ride on an event. Put a per-action value on its own
event's props; put a per-session attribute (e.g. `theme`) on `app_started`.
Reserve the `env` prop (on every event) for the dev/prod filter. Send numbers as
numbers (Aptabase aggregates them) and categorical values as strings.

**Dev vs prod traffic**: every event carries `env` (`development` in debug
builds, `production` otherwise; override with `JAL_TELEMETRY_ENV`) and
`isDebug`, so dev runs show only under the dashboard's **Debug** toggle. The app
key is baked in (`APTABASE_APP_KEY`, region encoded as `A-EU-…`); override with
`JAL_APTABASE_KEY`, and self-host with `JAL_APTABASE_HOST` (only for `A-SH-…` keys).

## Misc conventions

- Comments explain *why*, in English; code style matches the existing files (TypeScript: 2-space, single quotes, no semicolons; Rust: rustfmt defaults).
- `git log` field separators in `services/git.rs` are explicit `\x1f`/`\x1e` escapes - literal control characters once got silently lost in an edit and broke commit parsing. Keep escapes.
- Git identity for this repo: `doctorspider42 <doctorspider42@users.noreply.github.com>`.
