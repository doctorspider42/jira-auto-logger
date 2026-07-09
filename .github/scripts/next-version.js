// Computes the version for the next release and writes `version=X.Y.Z` to
// $GITHUB_OUTPUT. The version is the latest published GitHub release with its
// patch bumped by one - unless package.json declares a higher version, which
// wins (the escape hatch for jumping a minor/major). With no releases yet,
// package.json's version is used as-is for the first release.
//
// Requires `gh` (present on GitHub runners) and GH_TOKEN in the environment.
const { execSync } = require('node:child_process')
const { join } = require('node:path')
const fs = require('node:fs')

const pkgVersion = require(join(process.cwd(), 'package.json')).version

function latestReleaseVersion() {
  try {
    const out = execSync('gh release list --limit 1 --json tagName -q ".[0].tagName"', {
      encoding: 'utf8'
    }).trim()
    return out ? out.replace(/^v/, '') : null
  } catch {
    // No releases yet, or gh/network hiccup - treat as "no releases".
    return null
  }
}

/** Numeric semver comparison of dotted versions (prerelease tags ignored). */
function compare(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

const latest = latestReleaseVersion()
let version
if (!latest) {
  version = pkgVersion
} else if (compare(pkgVersion, latest) > 0) {
  version = pkgVersion
} else {
  const parts = latest.split('.').map(Number)
  parts[2] = (parts[2] || 0) + 1
  version = `${parts[0] || 0}.${parts[1] || 0}.${parts[2]}`
}

console.log(`package.json=${pkgVersion} latestRelease=${latest ?? '(none)'} -> ${version}`)
fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`)
