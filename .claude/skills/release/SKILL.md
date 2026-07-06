---
name: release
description: How to release Jira Auto Logger - version bumping, tagging, the GitHub Actions release workflow, built binaries and CI troubleshooting. Use this whenever the user asks to release, publish, ship a version, build installers, check why CI failed, or modify the GitHub workflow.
---

# Releasing and CI

## Releasing a version

```bash
# 1. bump "version" in package.json (semver), commit, push
# 2. tag and push the tag - this is what triggers the release build:
git tag v0.2.0
git push origin v0.2.0
```

The `Release` workflow (`.github/workflows/release.yml`) then builds on a
3-OS matrix and attaches to a GitHub release (with auto-generated notes):
- Windows: NSIS installer `dist/*.exe`
- macOS: `dist/*.dmg`
- Linux: `dist/*.AppImage`

Repo: `doctorspider42/jira-auto-logger`. Inspect runs with
`gh run list --repo doctorspider42/jira-auto-logger` / `gh run view <id>`.

## Manual runs

The workflow also has `workflow_dispatch`: a manual run (Actions → Release →
Run workflow, or `gh workflow run Release`) builds all three platforms and
uploads them as **workflow artifacts only** - no release is created. Use it to
smoke-test the pipeline without publishing.

The release-attach step is conditional on `startsWith(github.ref, 'refs/tags/')`;
keep that guard if you edit the workflow.

## Facts about the build

- Binaries are **unsigned** (`CSC_IDENTITY_AUTO_DISCOVERY: 'false'`) - SmartScreen/Gatekeeper will warn users. Signing requires certificates added as repo secrets plus electron-builder config; do not pretend builds are signed.
- Packaging config lives under the `"build"` key in `package.json` (appId `com.doctorspider42.jira-auto-logger`); electron-builder runs via `npx electron-builder --publish never` after `npm run build`.
- `npm ci` in CI retries twice with pauses - hosted runners occasionally throw `ECONNRESET` from the npm registry. A single red Linux job that died in `npm ci` within seconds is almost certainly that flake: `gh run rerun <id> --failed` first, investigate only if it fails repeatedly.
- Typecheck runs in CI before the build; a type error fails the release on all three platforms.

## Local installers

`npm run dist:win` / `dist:mac` / `dist:linux` produce the same artifacts
locally into `dist/` (you can only build for the OS you are on, mac requires
macOS). `out/` is the unpackaged app; both are gitignored.
