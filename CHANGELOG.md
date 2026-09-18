# Changelog

User-facing notes for each release, newest first. These are shown inside the
app (Settings → "What's new / history", and the "What's new" button on the
update banner) and used verbatim as the GitHub release description.

Format: one `## <version> — <YYYY-MM-DD>` section per released version, with
short bullet points describing changes a user would notice. The release
workflow picks the section whose version matches the one being published; a
push with no matching section falls back to GitHub's auto-generated notes.
Write for users, not for the commit log — see the `release` skill.

## 0.1.41 — 2026-09-18

- **Your standing instructions now reach the model in full.** A project's
  instruction and a custom field's instruction were cut to 600 and 300
  characters before being sent, silently — so a longer rule (say a definition of
  creative work with a list of what does *not* count as one) arrived
  half-finished and the model only ever saw its first paragraph. Both limits are
  now 4000 characters, which no realistic instruction hits.
- **Fixed: rules written into the old editable main prompt were dropped.** When
  the main prompt became built-in, the version stored in your config was deleted
  on the next launch — together with any rule you had written into it, with no
  warning and nowhere to find it. Those lines now move into
  Settings → LLM → "Extra LLM instructions", where they are sent as a
  highest-priority override. If your prompt was never edited, nothing is
  carried over. **Configs that were already migrated by an earlier version
  cannot be recovered** — if suggestions have been ignoring a rule of yours,
  retype it in that field.

## 0.1.40 — 2026-09-16

- Generated suggestions are no longer lost when you close the popup. They stay
  in memory until you log them or explicitly discard them, so you can go to
  settings, look something up, come back to the calendar and click that day
  again to pick up exactly where you left off — edits, notes and all. Days with
  waiting suggestions are marked with a ✎ in the month view, and step 2 has a
  **Discard suggestions** button for when you don't want them after all.
- Fixed suggestion generation failing with "The model returned malformed JSON"
  when the model added a closing remark after the JSON answer (or split it into
  one array per day). The response is now read by scanning for a complete JSON
  array instead of everything up to the last `]` in the text, so a trailing
  note mentioning an issue key like `[PROJ-12]` no longer breaks the whole run.
  When parsing does fail, the error details now carry the model's actual reply.

## 0.1.38 — 2026-09-14

- Reports can now group by **Worklog** — the same level Tempo offers next to
  Space and Work Item. Worklogs sharing a description are summed into one row,
  so a summary report can list the actual work done ("Code review", "Daily")
  with its total hours instead of only issue keys.

## 0.1.37 — 2026-08-20

- The auto logger has a third mode: **Notify only — open the day, log nothing**.
  At the configured time it shows a notification and nothing else; when you open
  the app (from the notification or the tray) it opens that day just as clicking
  it in the calendar does — you still pick the projects and start the generation
  yourself. Unlike confirmation mode it never pulls the window in front of what
  you are doing, and it never generates or logs anything on its own.

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
