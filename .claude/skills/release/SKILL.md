---
name: release
description: How to release Jira Auto Logger - version bumping, tagging, the GitHub Actions release workflow, built binaries and CI troubleshooting. Use this whenever the user asks to release, publish, ship a version, build installers, check why CI failed, or modify the GitHub workflow.
---

# Releasing and CI

## Releasing a version

Releases are **automatic**: every push to `main` publishes one. There is no
manual tag step - just merge to `main`.

The `Release` workflow (`.github/workflows/release.yml`) runs a `version` job
that computes the next version, then a 3-OS `build` matrix that packages and
publishes a GitHub release (auto-generated notes):
- Windows: NSIS installer `dist/*.exe` + `latest.yml` + `*.blockmap`
- macOS: `dist/*.dmg` + `latest-mac.yml`
- Linux: `dist/*.AppImage` + `latest-linux.yml`

The `latest*.yml` / blockmap files are what the in-app auto-updater
(electron-updater) reads - keep them in the uploaded `files:` globs.

Repo: `doctorspider42/jira-auto-logger`. Inspect runs with
`gh run list --repo doctorspider42/jira-auto-logger` / `gh run view <id>`.

## Versioning

`.github/scripts/next-version.js` computes the version: **latest published
release, patch-bumped** (0.1.4 → 0.1.5). `package.json` is *not* committed back
- it is only the "floor". The built app still reports the correct version
because CI runs `npm version <computed>` on the runner before building.

To jump a **minor/major**, bump `"version"` in `package.json` above the latest
release (e.g. to `0.2.0`) and push - the script honours it because it exceeds
the latest release, and patch-bumping resumes from there. With no releases yet,
the first release uses `package.json`'s version as-is.

`concurrency: group: release` serializes runs so two quick pushes don't compute
the same version. `workflow_dispatch` behaves the same as a push (publishes).

## Facts about the build

- Binaries are **unsigned** (`CSC_IDENTITY_AUTO_DISCOVERY: 'false'`) - SmartScreen/Gatekeeper will warn users. Signing requires certificates added as repo secrets plus electron-builder config; do not pretend builds are signed.
- Packaging config lives under the `"build"` key in `package.json` (appId `com.doctorspider42.jira-auto-logger`); electron-builder runs via `npx electron-builder --publish never` after `npm run build`.
- `npm ci` in CI retries twice with pauses - hosted runners occasionally throw `ECONNRESET` from the npm registry. A single red Linux job that died in `npm ci` within seconds is almost certainly that flake: `gh run rerun <id> --failed` first, investigate only if it fails repeatedly.
- Typecheck runs in CI before the build; a type error fails the release on all three platforms.

## Local installers

`npm run dist:win` / `dist:mac` / `dist:linux` produce the same artifacts
locally into `dist/` (you can only build for the OS you are on, mac requires
macOS). `out/` is the unpackaged app; both are gitignored.
