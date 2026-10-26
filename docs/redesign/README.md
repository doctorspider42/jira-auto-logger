<div align="center">

# Jira Auto Logger — Redesign

**A quieter, more minimal UI for logging time, plus a theme system that actually holds together.**

![Status](https://img.shields.io/badge/status-design%20proposal-9DB4FF?style=flat-square)
![Screens](https://img.shields.io/badge/screens-10-EDEEF0?style=flat-square)
![Themes](https://img.shields.io/badge/themes-12-F0B85A?style=flat-square)
![New](https://img.shields.io/badge/new-Jira%20issue%20creation-6FD8A0?style=flat-square)

</div>

---

This folder is the source of the redesign canvas: one `.dc.html` file per screen plus the
`canvas.json` that lays them out. Nothing here ships with the app yet — it is the target
the renderer will be moved towards.

> **Viewing the files.** The boards are Design Component pages for the Claude Design canvas.
> They load the canvas runtime (`./support.js`), so opening them straight in a browser
> shows unstyled markup. Open them in the canvas, or read them as reference markup:
> every colour, size and spacing value is inline.

## Principles

| | |
|---|---|
| **One accent, used sparingly** | Periwinkle `#9DB4FF` marks only today, the selection and focus. The primary button is white; everything else is greys. |
| **Numbers in mono** | Issue keys and hours use Geist Mono so columns line up and scan quickly. |
| **Progress, not boxes** | Days are a hairline grid with a thin 8h progress bar, not a wall of cards. Missing workdays say so. |
| **Show what will happen** | Primary buttons name the outcome: *Fill 2 missing days*, *Create 1 issue, log 24h*. |
| **Details on demand** | Suggestions are one dense row each; commits, rewrite hints and custom fields unfold only when needed. |
| **Accessible as drawn** | Real buttons, inputs and labels, ≥ 4.5:1 text contrast, icon buttons have labels. |

## Screens

| Board | What changes |
|---|---|
| [`Main.dc.html`](Main.dc.html) — Calendar, month | Side menu replaces top tabs. Month summary strip (logged hours, missing days, overtime) with *Fill missing days*. Panel for the selected day with a split per Jira connection. Interactive: click a day. |
| [`Day.dc.html`](Day.dc.html) — Calendar, day | One column per Jira connection, so a 16h day across two Jiras reads as two full 8h days, not an error. |
| [`Context.dc.html`](Context.dc.html) — New entries, step 1 | Project picker on the left, one card per project with a commits switch, the *What did you do?* note and a per-project **Allow new issues** switch. Prompt preview with a token estimate. |
| [`Review.dc.html`](Review.dc.html) — New entries, step 2 | Full-screen review with steps (Context → Review → Log), per-day hour bars, compact suggestion rows, the model that generated them, and a proposed **new issue** row. |
| [`IssuePicker.dc.html`](IssuePicker.dc.html) — Issue picker | Search results plus *Create “…” as a Task in INT* (Enter) or *Create with details…* (Shift+Enter). |
| [`NewIssue.dc.html`](NewIssue.dc.html) — New issue panel | Project, type, summary, a description drafted from notes and commits, a similar-issue warning, parent, assignee, sprint, fields the project requires, and *Then log 2h on Wed 12*. |
| [`Projects.dc.html`](Projects.dc.html) — Projects | List and detail. Sections for General, Jira targets (with a found-issues check), Repositories and Standing instruction. Save bar only when something changed. |
| [`Reports.dc.html`](Reports.dc.html) — Reports | Builder on the left (presets, scope, group levels to drag, document options), live A4 preview on the right. |
| [`Settings.dc.html`](Settings.dc.html) — Settings | Section list with an update badge. Connections as collapsible rows with status; Tempo fields as a compact table. |
| [`Themes.dc.html`](Themes.dc.html) — Theme system | The five-layer model and previews of all twelve rebuilt themes. |

## Creating Jira issues

New in this redesign. A Jira issue can be created in three ways, from most to least automatic:

1. **Proposed by the model.** With *Allow new issues* on for a project, the model may propose a
   new issue when nothing in the project fits the work. Review shows it as a *New issue* row
   with the closest existing match and *Use INT-13 instead*. Nothing is created until
   *Create 1 issue, log 24h*.
2. **Inline in the issue picker.** Typing something with no match offers *Create “…”* with the
   project's default type, assigned to you, in the active sprint.
3. **The full form.** From the picker (*Create with details…*), from a proposed row
   (*Edit issue…*) or from **New issue** in the calendar header.

Implementation notes for later:

- The Jira API token needs permission to create issues, not only to read them.
- The model's output must allow a proposed issue instead of a key; today `parseSuggestions`
  rejects any key outside the fetched issue pool.
- Required fields differ per project, so the form needs to fetch them from Jira before it is shown.

## Theme system

Every theme changes five layers and never the layout:

| Layer | Rule |
|---|---|
| **Palette** | Six tokens: ground, surface, line, ink, muted, accent. Every text pair checked at 4.5:1. |
| **Type** | A display face, a body face, a mono for keys and hours. |
| **Shape** | Radius and border weight, from square (Classic 95) to pill (Hello Kitty, Y2K). |
| **Texture** | At most one backdrop effect (scanlines, dither, polka), never behind inputs. |
| **Voice** | Optional reworded labels via `tt()` — loaders, empty states, the main button. |

The twelve themes: **Graphite** (default dark), **Paper** (default light), **iteo** (light + dark),
**Classic 95**, **Vault Terminal**, **New Vegas**, **Memory Card** (PS1), **Hello Kitty**,
**Y2K Chrome**, **Maa-sn-ek**, **Clair Obscur**, **Animus**.

## Files

```
docs/redesign/
  canvas.json          board positions and sizes on the canvas
  *.dc.html            one screen per file, all styles inline
  README.md            this file
```
