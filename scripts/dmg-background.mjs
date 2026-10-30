// Renders build/dmg-background.svg into the Retina TIFF the macOS DMG window
// shows (src-tauri/macos/dmg-background.tiff): a 1x and a 2x PNG from headless
// Chrome, joined by tiffutil so Finder picks the sharp one on Retina screens.
//
// Run with: npm run dmg-background   (macOS, needs Google Chrome)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SOURCE = resolve('build/dmg-background.svg')
const OUT = resolve('src-tauri/macos/dmg-background.tiff')
// The Finder window's content area in points - keep in step with the SVG
// viewBox and bundle.macOS.dmg.windowSize (which adds the 28pt title bar).
const WIDTH = 680
const HEIGHT = 420

const work = mkdtempSync(join(tmpdir(), 'jal-dmg-'))
try {
  const shots = [1, 2].map((scale) => {
    const png = join(work, `background@${scale}x.png`)
    execFileSync(CHROME, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      `--force-device-scale-factor=${scale}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      `--screenshot=${png}`,
      pathToFileURL(SOURCE).href
    ], { stdio: 'ignore' })
    return png
  })
  execFileSync('tiffutil', ['-cathidpicheck', ...shots, '-out', OUT], { stdio: 'inherit' })
  console.log(`wrote ${OUT}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
