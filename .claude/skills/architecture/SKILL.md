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

`JiraConnection` (Jira instance + Tempo token) → `ProjectConfig` (name, one Jira
project of one connection, optional `gitFolder` with per-repo author filter,
standing LLM instruction, calendar color) → the wizard generates **one isolated
LLM pass per selected project** (only that project's issues, commits, Tempo
style examples and note go into the context). `CustomFieldConfig` maps Tempo
work attributes (bool/string) per connection; values can be LLM-filled and can
mark calendar entries with an icon.

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
`src/renderer/src/i18n/pl.json` and `en.json` in the same change.

**Themes**: colors, radii, fonts and shadows are CSS variables defined per
theme in `src/renderer/src/theme/themes.ts`. Never hardcode a color in
component CSS - use the variables (or `color-mix` on them) so all four themes
keep working.

## LLM pipeline specifics

- The main prompt is **user-editable and stored in config** (`llm.mainPrompt`). If you change `DEFAULT_MAIN_PROMPT` (`src/main/services/defaultPrompt.ts`), existing users keep the old prompt until they click "Restore default" in settings - mention this in your summary whenever you touch the default prompt.
- Placeholders substituted by `LlmService`: `{{input}}` (compact JSON), `{{workingHoursPerDay}}`, `{{language}}`.
- Token discipline: input JSON is compact (no pretty-print), long fields are clipped, and per-project passes deliberately exclude other projects. Keep it that way.
- LLM output is never trusted: `parseSuggestions` validates issue keys against the real candidate pool, normalizes hours and custom-field types.
- Providers run sequentially across projects (CLI backends dislike concurrency).

## Misc conventions

- Comments explain *why*, in English; code style matches the existing files (2-space, single quotes, no semicolon-free style changes).
- `git log` field separators in `GitService` are explicit `\x1f`/`\x1e` escapes - literal control characters once got silently lost in an edit and broke commit parsing. Keep escapes.
- Git identity for this repo: `doctorspider42 <doctorspider42@users.noreply.github.com>`.
