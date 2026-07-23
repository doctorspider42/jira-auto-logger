# Changelog

User-facing notes for each release, newest first. These are shown inside the
app (Settings → "What's new / history", and the "What's new" button on the
update banner) and used verbatim as the GitHub release description.

Format: one `## <version> — <YYYY-MM-DD>` section per released version, with
short bullet points describing changes a user would notice. The release
workflow picks the section whose version matches the one being published; a
push with no matching section falls back to GitHub's auto-generated notes.
Write for users, not for the commit log — see the `release` skill.

## 0.1.13 — 2026-07-23

- Added a **"What's new"** view: when an update is available you can preview the
  release notes before installing, straight from the update banner.
- Added a **version history** browser in Settings → Updates, listing the notes
  for every published release and marking the version you have installed.
