// Rasterises build/icon.svg to build/icon.png (1024x1024) - the single PNG
// electron-builder needs to derive the Windows .ico, macOS .icns and the Linux
// icon set from.
//
// Runs inside Electron rather than Node so the project needs no image
// dependency: Chromium already renders SVG. The window renders offscreen (no
// visible flash, works headless in CI) and the first 'paint' frame carries the
// alpha of the rounded corners.
//
// Run with: npm run icon   (after editing build/icon.svg)

import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 1024

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'build', 'icon.svg')
const pngPath = join(root, 'build', 'icon.png')

// A fractional device scale factor would resample the capture and soften the
// edges, so pin it to 1 and let SIZE alone decide the resolution.
app.commandLine.appendSwitch('force-device-scale-factor', '1')

const page = `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  svg { display: block; width: ${SIZE}px; height: ${SIZE}px; }
</style>
${readFileSync(svgPath, 'utf-8')}`

function fail(message) {
  console.error(`[render-icon] ${message}`)
  app.exit(1)
}

await app.whenReady()

const window = new BrowserWindow({
  width: SIZE,
  height: SIZE,
  useContentSize: true,
  show: false,
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',
  webPreferences: { offscreen: true }
})

// Never hang: an offscreen window that never paints would otherwise keep the
// Electron process alive forever, e.g. in CI.
const timeout = setTimeout(() => fail('timed out waiting for the first frame'), 30_000)

window.webContents.once('paint', (_event, _dirty, image) => {
  clearTimeout(timeout)
  const { width, height } = image.getSize()
  if (width !== SIZE || height !== SIZE) {
    fail(`unexpected frame size ${width}x${height}, expected ${SIZE}x${SIZE}`)
  }
  writeFileSync(pngPath, image.toPNG())
  console.log(`[render-icon] wrote ${pngPath} (${width}x${height})`)
  app.exit(0)
})

await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
