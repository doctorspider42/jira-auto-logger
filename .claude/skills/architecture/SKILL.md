---
name: architecture
description: Code map and conventions of the Jira Auto Logger Electron app - process layers, typed IPC contract, domain model, LLM pipeline, config migrations, i18n and theming rules. Use this before adding any feature, changing the config shape, adding an IPC channel, touching the LLM prompt, or modifying Jira/Tempo integration - it contains the checklists that keep changes consistent.
---

# Architecture and conventions

## Layers

```
src/shared/    domain types (domain.ts) + IPC contract (ipc.ts). No Electron/DOM imports.
src/main/      all logic. Renderer never calls external APIs directly.
src/preload/   contextBridge exposing `window.api` (typed as shared IpcApi).
src/renderer/  React UI. zustand store (store/appStore.ts), i18next, CSS-variable themes.
```

Key main-process services (`src/main/services/`):
- `ConfigService` - persists config JSON in userData; encrypts tokens with `safeStorage`; **all shape migrations live in `load()`** (legacy fields are typed as `LegacyFields` and mapped over defaults).
- `ConnectionManager` - resolves a `connectionId` to cached `JiraApi`/`TempoApi` clients (or mocks in mock mode) and caches the Jira accountId.
- `JiraClient` / `TempoClient` / `GitService` - thin API clients behind the interfaces `JiraApi`, `TempoApi`, `CommitSource` (mocks implement the same interfaces).
- `llm/LlmService` - orchestration; providers (`ClaudeCliProvider`, `CopilotCliProvider`, `OpenAiApiProvider`) implement `LlmProvider` and only turn a prompt string into a response string.

## Domain model in one breath

`JiraConnection` (Jira instance + Tempo token) → `ProjectConfig` (name, one or
more `targets` - each a Jira project of one connection, e.g. the client's Jira
and the company Jira - `gitFolders` with per-repo author filter, standing LLM
instruction, calendar color) → the wizard generates **one isolated LLM pass per
target of every selected project** (only that target's issues, Tempo style
examples, the project's commits and note go into the context; hours are NOT
split between targets - each Jira gets full, independent entries).
`CustomFieldConfig` maps Tempo work attributes (bool/string) per connection;
values can be LLM-filled and can mark calendar entries with an icon.

## Checklists

**Adding an IPC endpoint** (do all five, typecheck catches misses):
1. Types in `src/shared/domain.ts` if needed.
2. Method on `IpcApi` + channel constant in `src/shared/ipc.ts`.
3. Handler in `src/main/ipc.ts` - always wrap in `toResult(channel, fn)` so errors serialize and get logged.
4. Passthrough in `src/preload/index.ts`.
5. Renderer calls `window.api.*` and branches on `Result` (`result.ok`).

**Errors**: throw `AppException(code, message, details)` in main; the renderer
translates the `code` via `errors.*` i18n keys (`ErrorBanner`). Adding a new
code means adding it to `AppErrorCode` and both locale files.

**Adding a config field**:
1. `AppConfig` in domain.ts, 2. default in `ConfigService.defaultConfig()`,
3. migration/normalization in `ConfigService.load()` if old files need mapping,
4. `mockConfig()` in `services/mock/data.ts`, 5. settings UI + i18n.

**i18n**: every user-visible string goes through `t()`; add keys to **both**
`src/renderer/src/i18n/pl.json` and `en.json` in the same change. Some strings
are also **reworded per theme** (`themeCopy.*`, see Themes below) - before
renaming or removing a key, grep for it under `themeCopy`: nothing typechecks
i18n key strings, so a rename silently orphans the theme's version and the UI
quietly falls back to the default wording.

**Themes**: colors, radii, fonts and shadows are CSS variables defined per
theme in `src/renderer/src/theme/themes.ts`. Never hardcode a color in
component CSS - use the variables (or `color-mix` on them) so every theme in
`THEMES` keeps working.

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

- The main prompt is **baked into the app** (`MAIN_PROMPT` in `src/main/services/defaultPrompt.ts`), not stored in config - editing it takes effect for everyone on the next release. The user can only append free-form guidance via `llm.additionalInstructions`, which `LlmService` injects at the `{{additionalInstructions}}` placeholder as a highest-priority override.
- Placeholders substituted by `LlmService`: `{{input}}` (compact JSON), `{{workingHoursPerDay}}`, `{{language}}`, `{{additionalInstructions}}`. The last also carries the per-date `hoursAlreadyLogged` context so suggestions top a day up to `workingHoursPerDay` instead of re-logging existing entries.
- Token discipline: input JSON is compact (no pretty-print), long fields are clipped, and per-project passes deliberately exclude other projects. Keep it that way.
- LLM output is never trusted: `parseSuggestions` validates issue keys against the real candidate pool, normalizes hours and custom-field types.
- Providers run sequentially across projects (CLI backends dislike concurrency).

## Telemetry (Aptabase)

Anonymous, opt-out usage telemetry lives entirely in the main process
(`src/main/services/TelemetryService.ts`) - the renderer has no `ipcRenderer`
under `contextIsolation`, so **never** try to track from the renderer. Aptabase
attributes anonymous sessions, app version and OS automatically; we add only
coarse custom events.

Hard rules learned the hard way:
- **`initialize` must run before the app `ready` event.** The SDK disables
  itself (silent except a `console.warn`) if the app is already ready, and every
  event then buffers forever and is never sent. It is called at module load in
  `src/main/index.ts`, *not* inside `whenReady`. Keep it there.
- `initialize` does **no** network I/O by itself - nothing is sent until an
  event fires - so it runs unconditionally (given an app key and non-mock). The
  opt-out (`config.telemetry.enabled`) and mock-mode gates live in
  `TelemetryService.track()`, checked per event so the setting takes effect at
  runtime with no restart. `bindConfig()` wires the config source in
  `registerIpcHandlers` (after `ready`, when config exists).
- Never send content: no issue keys, descriptions, credentials, paths, notes.
  Only counts, durations, enums. `trackEvent` props accept `string | number |
  boolean` only.
- **Mock mode never phones home** (`isMockMode()` gate + `telemetry.enabled:
  false` in `mockConfig()`). Keep both.

**Adding a new event**: add a `trackFoo()` method on `TelemetryService` that
calls the private `track()` (so it inherits gating + the `env` common prop), then
call it from the relevant main-process site (e.g. an IPC handler, after success).
Don't call `trackEvent` directly from handlers.

**Event props vs session attributes**: Aptabase has **no** user/session-property
API - the SDK already stamps OS, app version and locale onto *every* event as
system props, and custom values can only ride on an event. Put a per-action
value on its own event's props; put a per-session attribute (e.g. `theme`) on
`app_started` and segment by breaking that event down. Reserve the `env` common
prop (on every event) for the dev/prod filter dimension you apply across all
event types. Send numbers as numbers (Aptabase aggregates them - sum/avg) and
categorical values as strings (shown as value breakdowns).

**Dev vs prod traffic**: every event carries an `env` prop
(`development`/`production` from `app.isPackaged`, override with
`JAL_TELEMETRY_ENV`, e.g. `test`). Aptabase also splits unpackaged runs via its
own `isDebug` flag. So `dev` runs appear only under the dashboard's **Debug**
toggle (not the default Release view) and can be filtered by `env`. The app key
is baked in (`APTABASE_APP_KEY`, region encoded as `A-EU-…`); override with
`JAL_APTABASE_KEY`, and self-host with `JAL_APTABASE_HOST` (only honored for
`A-SH-…` keys - the SDK forces the region host for US/EU keys).

## Misc conventions

- Comments explain *why*, in English; code style matches the existing files (2-space, single quotes, no semicolon-free style changes).
- `git log` field separators in `GitService` are explicit `\x1f`/`\x1e` escapes - literal control characters once got silently lost in an edit and broke commit parsing. Keep escapes.
- Git identity for this repo: `doctorspider42 <doctorspider42@users.noreply.github.com>`.
