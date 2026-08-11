# Changelog

User-facing notes for each release, newest first. These are shown inside the
app (Settings → "What's new / history", and the "What's new" button on the
update banner) and used verbatim as the GitHub release description.

Format: one `## <version> — <YYYY-MM-DD>` section per released version, with
short bullet points describing changes a user would notice. The release
workflow picks the section whose version matches the one being published; a
push with no matching section falls back to GitHub's auto-generated notes.
Write for users, not for the commit log — see the `release` skill.

## 0.1.36 — 2026-08-11

- In the **Clair Obscur ◆ Expedition 33** theme, a day with nothing logged now
  carries its date as a single numeral filling the whole tile, the way the
  expedition journals are numbered, and in a brighter ink than before — the date
  was hard to read at the old weight.
- The outline of the hexagonal header tabs in that theme keeps an even weight
  all the way into its points instead of thinning out at them.
- Fixed weekends of the neighbouring months showing up at full strength in the
  month view, so they looked like part of the month you are on. They are now
  dimmed like every other day outside it.

## 0.1.35 — 2026-08-10

- Themes can now bring their own wording. The **Clair Obscur ◆ Expedition 33**
  theme uses it: while suggestions are generating it shows its own 33 loading
  messages instead of the usual jokes, and the button that logs them to Jira reads
  **We Continue** (**Przemy naprzód** in Polish).

## 0.1.33 — 2026-08-10

- Added a **Clair Obscur ◆ Expedition 33** theme under Settings → Appearance →
  Theme: a black oil canvas with an art-nouveau lattice painted under it, panels
  framed by hand-drawn corner brackets, everything set in an old-style serif with
  gold small-caps headings, and petals and dust drifting across the window the
  whole time. Tabs are the game's elongated hexagons, picking something fills it
  dark plum rather than gold, and the loading indicator is a gauge with pointed
  caps. (Honors "reduce motion" — the petals stop.)

## 0.1.32 — 2026-08-06

- Prevented Jira Auto Logger from opening more than once, so a repeated launch
  now brings the existing window forward instead of adding another tray icon.

## 0.1.29 — 2026-08-05

- Added a hidden **maa-sn-ek** theme, because logging time is harassment: a
  concrete wall, black paint running off the header, cardboard placards taped up
  crooked, a hand-lettered banner you can't scroll away from and a painted plank
  along the bottom of the window. It is deliberately **not** in
  Settings → Appearance → Theme — if you know how to get to it, it's yours.
  (Honors "reduce motion" if you'd rather the banner stopped moving.)

## 0.1.25 — 2026-07-31

- Anonymous usage telemetry now also counts **generated monthly reports** — just
  the fact that one was created, with no details about its contents or settings.
  Turn it off under Settings → Privacy & telemetry.

## 0.1.23 — 2026-07-30

- The installed version is now shown next to the app name in the header, so you
  can tell at a glance which build you are running without opening Settings.

## 0.1.21 — 2026-07-27

- Added a **PS1 ✕ BIOS** theme — the original PlayStation boot screen as a work
  app: CRT scanlines, a power-on flash, hard-beveled memory-card-manager panels,
  dithered surfaces and the four face-button colours doing the semantic work.
  Pick it under Settings → Appearance → Theme. (Honors "reduce motion" if you'd
  rather skip the boot sequence.)

## 0.1.20 — 2026-07-27

- Added two **iteo** company themes — light and dark — built from the official
  brand palette (orange accent on graphite). Pick them under
  Settings → Appearance → Theme. They use the Codec Cold typeface when it's
  installed on your machine and fall back to Verdana otherwise.
- Fixed the clock icon in Settings → "Workday start" being almost invisible on
  the dark themes. Scrollbars and autofill now follow the theme too.

## 0.1.19 — 2026-07-24

- Added optional **anonymous usage telemetry** (Aptabase) to help guide what to
  work on next. It reports only anonymous sessions and a time-logged event
  (entry count and total hours) — never issue keys, descriptions, credentials
  or any personal data. It's on by default; turn it off under
  Settings → Privacy & telemetry.

## 0.1.17 — 2026-07-24

- Added a gloriously over-the-top **Y2K ✧ Ultra** theme — Frutiger-Aero
  holographic backdrop, brushed-chrome header, aqua candy buttons and glossy
  frosted cards. Pick it under Settings → Appearance → Theme. (Honors "reduce
  motion" if you'd rather the gradients hold still.)

## 0.1.14 — 2026-07-23

- Added a **Hello Kitty** theme — a soft pink Sanrio look with rounded corners,
  pick it under Settings → Appearance → Theme.

## 0.1.13 — 2026-07-23

- Added a **"What's new"** view: when an update is available you can preview the
  release notes before installing, straight from the update banner.
- Added a **version history** browser in Settings → Updates, listing the notes
  for every published release and marking the version you have installed.
