// Guards against the cryptic "Error: Electron uninstall" that electron-vite
// throws when node_modules/electron has no downloaded binary (interrupted
// install, proxy/firewall, or `npm install --ignore-scripts`).
//
// Runs before every dev/preview command and as a postinstall hook. It is a
// no-op when the binary is already present, so it adds no measurable startup
// cost. When the binary is missing it re-runs electron's own install script,
// and if that fails it prints an actionable message instead of a stack trace.

import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
const pathTxt = join(electronDir, 'path.txt')
const installScript = join(electronDir, 'install.js')

function binaryPresent() {
  if (!existsSync(pathTxt)) return false
  const rel = readFileSync(pathTxt, 'utf-8').trim()
  return rel.length > 0 && existsSync(join(electronDir, 'dist', rel))
}

if (binaryPresent()) process.exit(0)

if (!existsSync(installScript)) {
  console.error(
    '\n[ensure-electron] The "electron" package is not installed.\n' +
      '                  Run: npm install\n'
  )
  process.exit(1)
}

console.log('[ensure-electron] Electron binary missing — downloading it...')
try {
  execFileSync(process.execPath, [installScript], { stdio: 'inherit', cwd: electronDir })
} catch {
  console.error(
    '\n[ensure-electron] Failed to download the Electron binary.\n' +
      '                  This is usually a proxy/firewall blocking the download.\n' +
      '                  Try one of:\n' +
      '                    - set a mirror: ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ then reinstall\n' +
      '                    - remove node_modules/electron and run: npm install\n'
  )
  process.exit(1)
}

if (!binaryPresent()) {
  console.error('\n[ensure-electron] Electron is still unavailable after install.\n')
  process.exit(1)
}

console.log('[ensure-electron] Electron binary ready.')
