# Changelog

User-facing notes for each release, newest first. These are shown inside the
app (Settings → "What's new / history", and the "What's new" button on the
update banner) and used verbatim as the GitHub release description.

Format: one `## <version> — <YYYY-MM-DD>` section per released version, with
short bullet points describing changes a user would notice. The release
workflow picks the section whose version matches the one being published; a
push with no matching section falls back to GitHub's auto-generated notes.
Write for users, not for the commit log — see the `release` skill.

## 1.0.1 — 2026-10-30

- **Intel Macs are supported again.** The macOS download is now one app that
  runs on both Apple Silicon and Intel Macs; 1.0.0 only ran on Apple Silicon.

## 1.0.0 — 2026-10-30

**Updating from 0.1.x.** On Windows and Linux the app updates itself into
this version as usual - after the restart it is the new app, with your
settings and projects. On macOS the old version cannot install updates: open
the release page from the update banner, download the `.dmg` and drag the app
into Applications, replacing the old one. On macOS and Linux, paste your Jira,
Tempo and OpenAI tokens again in Settings → Jira accounts (and AI assistant):
the new app cannot read the copies the old one locked in the system keychain.

- **A lighter, faster app.** Jira Auto Logger is rebuilt on Tauri with a Rust
  core instead of Electron. The installer shrinks from about 98 MB to about
  3 MB. Your settings, tokens and logs carry over untouched, and the old
  version updates itself into this one.
- **A new, quieter look.** Navigation moved to a slim side bar, and the
  calendar shows each day's progress towards your working day, flags workdays
  with nothing logged and sums the month at the top - with one button to fill
  the empty days.
- **A panel for the selected day.** Clicking a day now shows what it holds,
  per Jira, beside the calendar; double-click (or "Suggest entries") opens the
  new entries flow.
- **Day view per Jira.** When you log to several Jiras, each gets its own lane,
  so a day logged to two of them reads as two full days.
- **New entries, step by step.** Adding entries is now a full-screen flow:
  pick projects and write notes, then review compact rows with an hours
  stepper and descriptions you edit in place.
- **Week view.** A third calendar view shows the week as columns, with every
  entry as a card - a whole week at a glance without opening each day.
- **Create Jira issues.** "New issue" on the calendar creates one straight
  away. When adding entries you can let the model propose a new issue where
  no existing one fits; it shows as "New issue" in the review, you can edit or
  swap it for an existing one, and it is created in Jira right before its time
  is logged. The issue picker can also create one from what you typed.
- **Reports as a builder.** The report screen is a single column of choices
  (month, Jiras, projects, grouping, document) beside a large live preview of
  the page, with presets one click away.
- **Less text on screen.** Long explanations moved behind small "?" tips.
- **Fits narrow windows.** In a narrower window the calendar toolbar stays on
  one line: the task filter becomes a search icon (Ctrl+K opens it at any
  width), "New issue" keeps only its icon and the views shorten to one letter.
- **Friendlier settings that save themselves.** Settings are six short
  sections: Jira accounts as cards with their status, the AI assistant picked
  from tiles, a gallery of themes, automation written as a sentence. There is
  no Save button any more - changes are kept as you make them.
- **Fold the day panel away.** The panel beside the calendar folds into a thin
  strip (button in its corner, or Ctrl+B) when you want the whole width.
- **A day panel that helps fill the day.** On an empty day it shows your
  commits from that day, offers to copy the same weekday from last week in one
  click and has quick "+1 h" buttons for your recent issues. A full day shows
  how it splits across projects, and every day shows a small chart of its week.
- **Fold the weekend.** The arrow next to "Sun" folds Saturday and Sunday into
  a narrow strip (with a dot when something is logged there); click it to
  bring them back.
- **Projects as a list.** Projects sit in a list with an editor beside it, with
  ready-made colours to pick from.
- **Every theme rebuilt, with its old soul.** Themes fit the new layout and
  keep everything that made them themselves: PS1's CRT scanlines, power-on
  flash and pressable bevels, Clair Obscur's falling petals, journal numerals
  and hexagon tabs, Animus's fog with formulas rising through it, Y2K's chrome
  and candy buttons, the maa-sn-ek banner and picket line, navy title bars in
  Classic 95 and a phosphor glow on the Fallout terminals. The default dark and
  light themes are now Graphite and Paper.
- **Window backdrop.** On Windows the window shows a blurred backdrop (Mica on
  Windows 11, Acrylic on Windows 10) - except in the themes that paint their
  own background.

## 0.1.45 — 2026-09-29

- **Each Jira in a project now has its own standing instruction.** When a
  project logs to several Jiras (say, the client's and your company's), you
  can tell the LLM how to write entries for each one separately, e.g.
  client-friendly wording in the client's Jira and short internal notes in
  yours. Your existing project instruction is copied to every Jira of that
  project, so nothing changes until you edit them.

## 0.1.44 — 2026-09-29

- **The Animus theme no longer stutters.** The rising formulas and the fog
  used to repaint the whole window on every frame, and each panel re-blurred
  the sky behind it, which made the app choppy and nearly unusable on 4K
  screens. The sky now moves on the graphics card, and it looks the same. One
  fog bank also stops jumping each time its loop restarts.

## 0.1.43 — 2026-09-25

- **New theme: Animus ▲ 1.28.** The first Assassin's Creed's Animus menus —
  a cloudy steel-blue sky crossed by thin white lines, dark slate blocks with
  `>` in front of every tab, the current one in solid black, and pale glowing
  cyan for the Animus's own layer. Structural formulas of DNA/RNA bases rise
  slowly out of the fog, and a sync sweep re-renders the screen from the bottom
  up. The loader turns into a spinning DNA helix with Abstergo's own
  (Jira-flavoured) status lines, errors briefly desynchronise, and the
  log-time button now reads **Synchronize**. Pick it in Settings → Appearance.

## 0.1.42 — 2026-09-25

- **See which model wrote your suggestions.** The review step now says in
  small print which model generated them — the real one, not just the alias
  from your settings: with Claude set to `opus` it shows e.g.
  `claude-opus-5-5`. The OpenAI API reports its exact model snapshot too; for
  the Copilot CLI, which doesn't report it, the configured model is shown.

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
