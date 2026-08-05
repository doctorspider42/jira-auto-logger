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
publishes a GitHub release (notes from `CHANGELOG.md`, see below):
- Windows: NSIS installer `dist/*.exe` + `latest.yml` + `*.blockmap`
- macOS: `dist/*.dmg` + `latest-mac.yml`
- Linux: `dist/*.AppImage` + `latest-linux.yml`

The `latest*.yml` / blockmap files are what the in-app auto-updater
(electron-updater) reads - keep them in the uploaded `files:` globs.

Repo: `doctorspider42/jira-auto-logger`. Inspect runs with
`gh run list --repo doctorspider42/jira-auto-logger` / `gh run view <id>`.

## Release notes (`CHANGELOG.md`) — do this for every user-facing change

The app has an in-app **"What's new" / version history** view (Settings →
Updates, and the update banner) that fetches the GitHub releases and shows
their descriptions. Those descriptions come from `CHANGELOG.md`, so the notes
must be **user-facing**, not a commit dump.

Because **every push to `main` publishes a release**, the CHANGELOG entry has to
land *in the same push* as the change. Whenever a change is something a user
would notice (a feature, a visible fix, a behaviour change), add a section to
the top of `CHANGELOG.md` before merging:

1. Determine the version this push will publish. It is the latest published
   release patch-bumped (`gh release list --limit 1` → e.g. `v0.1.12` →
   `0.1.13`), unless `package.json`'s version is higher (a deliberate
   minor/major jump), in which case use that. This is exactly what
   `next-version.js` computes.
2. Add `## <version> — <YYYY-MM-DD>` at the top of `CHANGELOG.md` with short
   bullet points written for users (what changed and why it matters), not
   commit messages. Group related commits into one bullet.
3. If you are batching several merges before they land, keep appending bullets
   under the same upcoming-version heading; rename it if the computed version
   shifts (e.g. someone else released in between).

**A stale heading fails the check instead of being ignored.**
`.github/scripts/check-changelog.js` compares the heading a change adds against
the version that would be published, and fails with the name to rename it to.
It runs in two places:

- **On every PR against `main`** (`.github/workflows/pr.yml`), diffing the whole
  branch against its base. The version here is a prediction - the latest release
  patch-bumped, assuming this PR merges next - so if another PR releases first,
  re-run the check to get the new number.
- **On push to `main`**, in the `create-release` job, before anything is
  published. Same script, diffing `HEAD~1..HEAD`.

Two kinds of change skip the check: one that adds no heading at all (internal
changes still fall back to auto-generated notes as intended), and one that only
renumbers an *older* heading - no new body text in the diff and the newest
section left alone. Renumbering the newest section counts as an entry for this
release and must match, because a fix-up that renumbers a stale entry is exactly
the change that can go stale a second time.

This exists because the failure used to be silent, and it bit three feature
releases in a row: the Y2K section was written as `## 0.1.15` but shipped as
v0.1.17, telemetry as `## 0.1.18` but shipped as v0.1.19, and the iteo themes as
`## 0.1.19` but shipped as v0.1.20. Each time the curated text was dropped and
the release went out with a commit dump, unnoticed until it surfaced in the
in-app "What's new". Those three headings have since been renamed to match their
tags, so "latest section + 1" is a trustworthy guess again - but derive the
number from `gh release list`, which is what CI actually uses.

The protest theme (#24) then hit it from the other side: the check caught the
stale `## 0.1.26` heading, but only after the merge, so `main` sat on a red
release with the branch already gone. That is why the check now runs on the PR.

The `create-release` job runs `.github/scripts/release-notes.js <version>`,
which extracts the matching `## <version>` section and uses it as the release
body. **Purely internal pushes** (refactors, CI, docs) need no entry — with no
matching section the workflow falls back to GitHub's auto-generated commit
notes, which is fine for releases users don't need to read about.

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
