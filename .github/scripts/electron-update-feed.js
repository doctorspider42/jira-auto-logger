// Writes the electron-updater feeds (latest.yml, latest-linux.yml) for a Tauri
// release, so installed Electron builds update themselves into the Tauri app:
// their updater reads these files, downloads the Tauri installer they point
// at, checks its SHA-512 and runs it.
//
// Usage: node electron-update-feed.js <version> <dir>
// <dir> holds the release assets downloaded from GitHub; the feeds are written
// next to them.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const [version, dir] = process.argv.slice(2)
if (!version || !dir) {
  console.error('Usage: node electron-update-feed.js <version> <dir>')
  process.exit(1)
}

function feed(fileName) {
  const data = fs.readFileSync(path.join(dir, fileName))
  const sha512 = crypto.createHash('sha512').update(data).digest('base64')
  // GitHub serves assets under the URL-encoded file name.
  const url = fileName.replace(/ /g, '.')
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${url}`,
    `    sha512: ${sha512}`,
    `    size: ${data.length}`,
    `path: ${url}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    ''
  ].join('\n')
}

const files = fs.readdirSync(dir)
const targets = [
  ['latest.yml', files.find((f) => f.endsWith('-setup.exe'))],
  ['latest-linux.yml', files.find((f) => f.endsWith('.AppImage'))]
]
for (const [feedName, asset] of targets) {
  if (!asset) {
    console.error(`No asset for ${feedName}`)
    process.exit(1)
  }
  fs.writeFileSync(path.join(dir, feedName), feed(asset))
  console.log(`${feedName} -> ${asset}`)
}
