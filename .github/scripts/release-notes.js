// Extracts the CHANGELOG.md section for a given version and writes it to
// $GITHUB_OUTPUT as the release body. The release workflow uses this as the
// GitHub release description (our curated, user-facing "what's new"); when a
// version has no section, `has_notes=false` is emitted and the workflow falls
// back to GitHub's auto-generated notes.
//
// Usage: node .github/scripts/release-notes.js <version>
const { join } = require('node:path')
const fs = require('node:fs')

const version = (process.argv[2] || '').replace(/^v/, '').trim()
const changelogPath = join(process.cwd(), 'CHANGELOG.md')

/** Returns the body of the `## <version> ...` section, or '' when absent. */
function extractSection(markdown, target) {
  const lines = markdown.split('\n')
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Match "## 1.2.3" optionally followed by " — date" or similar.
  const headingRe = new RegExp(`^##\\s+v?${escaped}(\\s|$)`)
  const out = []
  let capturing = false
  for (const line of lines) {
    if (capturing && /^##\s/.test(line)) break
    if (capturing) {
      out.push(line)
      continue
    }
    if (headingRe.test(line)) capturing = true
  }
  return out.join('\n').trim()
}

let body = ''
if (version && fs.existsSync(changelogPath)) {
  body = extractSection(fs.readFileSync(changelogPath, 'utf8'), version)
}

const hasNotes = body.length > 0
console.log(hasNotes ? `Found CHANGELOG notes for ${version}` : `No CHANGELOG notes for ${version}`)

const output = process.env.GITHUB_OUTPUT
if (output) {
  fs.appendFileSync(output, `has_notes=${hasNotes}\n`)
  // Multiline value via a heredoc-style delimiter.
  fs.appendFileSync(output, `body<<RELEASE_NOTES_EOF\n${body}\nRELEASE_NOTES_EOF\n`)
}
