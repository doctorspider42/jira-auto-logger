// Fails when a change writes CHANGELOG notes under a heading numbered for a
// different version than the one that would actually be published.
//
// Runs twice: on every pull request (where the version is a prediction - the
// latest release patch-bumped, assuming this PR merges next) and again in the
// release workflow on push to main, where that prediction has become fact.
//
// Why this exists: the version is computed from the latest published release,
// so a section written as `## 0.1.19` goes stale the moment someone else
// releases first. release-notes.js then finds no matching section, quietly sets
// has_notes=false, and the release ships with auto-generated commit notes - the
// curated text is dropped without a word. That happened three times in a row
// (Y2K, telemetry, the iteo themes).
//
// Two kinds of change are deliberately let through:
//   - one that adds no heading at all: internal changes (CI, refactors, docs)
//     are meant to fall back to generated notes
//   - one that only renumbers an *older* heading: renaming `## 0.1.15` to
//     `## 0.1.17` to match the tag it really shipped under is a correction to
//     history, not an entry for this release. It is told apart by the diff
//     carrying no new body text (a rename touches the heading line and nothing
//     else, while a real entry brings bullets with it) and by leaving the
//     newest section in the file alone.
//
// That second exemption used to be about new body text only, which left the
// silent drop reachable by the one change most likely to hit it: a fix-up that
// renumbers a stale entry written by an earlier push. Its diff is a bare
// rename, so it was skipped - and if the number was stale again, the notes were
// dropped exactly as before. Renumbering the newest section is therefore
// treated as an entry for this release and has to match.
//
// Usage: node .github/scripts/check-changelog.js <version> [baseRef]
//
// baseRef is what the change is diffed against: the previous tip of main
// (HEAD~1, the default) for a push, or the PR's base commit on a pull request,
// so the whole branch is examined rather than only its last commit.
const { execSync } = require('node:child_process')
const { join } = require('node:path')

const version = (process.argv[2] || '').replace(/^v/, '').trim()
if (!version) {
  console.error('check-changelog: no version argument')
  process.exit(1)
}

const baseRef = (process.argv[3] || 'HEAD~1').trim()
if (!/^[\w./~^-]+$/.test(baseRef)) {
  console.error(`check-changelog: refusing to use "${baseRef}" as a git ref`)
  process.exit(1)
}

let diff
try {
  diff = execSync(`git diff ${baseRef} HEAD -- CHANGELOG.md`, { encoding: 'utf8' })
} catch {
  // Shallow clone or the very first commit - nothing to compare against.
  console.log(`check-changelog: cannot diff against ${baseRef}, skipping`)
  process.exit(0)
}

// Added lines only, minus the `+++ b/CHANGELOG.md` file header.
const addedLines = diff
  .split('\n')
  .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
  .map((l) => l.slice(1))

const addedHeadings = addedLines
  .map((l) => /^##\s+v?(\d+\.\d+\.\d+)/.exec(l))
  .filter(Boolean)
  .map((m) => m[1])

if (addedHeadings.length === 0) {
  console.log('check-changelog: this change adds no CHANGELOG section, nothing to verify')
  process.exit(0)
}

/** The version of the newest (topmost) section in CHANGELOG.md, or null. */
function newestSectionVersion() {
  try {
    const md = require('node:fs').readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8')
    for (const line of md.split('\n')) {
      const m = /^##\s+v?(\d+\.\d+\.\d+)/.exec(line)
      if (m) return m[1]
    }
  } catch {
    /* no CHANGELOG at all - nothing to verify below either */
  }
  return null
}

const addedBody = addedLines.filter((l) => l.trim() !== '' && !/^##\s/.test(l))
if (addedBody.length === 0 && !addedHeadings.includes(newestSectionVersion())) {
  console.log(
    `check-changelog: only renumbered older headings (${addedHeadings.join(', ')}), no new notes, skipping`
  )
  process.exit(0)
}

if (addedHeadings.includes(version)) {
  console.log(`check-changelog: CHANGELOG section ${version} matches the release being published`)
  process.exit(0)
}

const onPullRequest = process.env.GITHUB_EVENT_NAME === 'pull_request'

console.error(
  [
    '',
    `This change adds CHANGELOG notes under ${addedHeadings.join(', ')},`,
    onPullRequest
      ? `but merging it would publish ${version}.`
      : `but the release being published is ${version}.`,
    '',
    'The version comes from the latest published release, patch-bumped, so an',
    'entry written earlier goes stale as soon as someone else releases first.',
    'Left alone, this release would ship with auto-generated commit notes and',
    'your text would never reach the in-app "What\'s new".',
    '',
    `Fix: rename the heading in CHANGELOG.md to "## ${version} — <date>" and push again.`,
    ...(onPullRequest
      ? [
          '',
          `${version} is what this PR would publish if it merges next; if another PR`,
          'releases first, re-run this check to get the new number.'
        ]
      : []),
    ''
  ].join('\n')
)
process.exit(1)
