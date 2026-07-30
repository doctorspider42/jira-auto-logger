// Rasterises build/icon.svg to build/icon.png (1024x1024) - the single PNG
// electron-builder needs to derive the Windows .ico, macOS .icns and the Linux
// icon set from.
//
// Runs inside Electron rather than Node so the project needs no image
// dependency: Chromium already renders SVG. The window renders offscreen, so
// nothing flashes on screen and the first painted frame carries the alpha of
// the rounded corners. (capturePage() is not an option here: on a hidden window
// it fails with UnknownVizError because nothing composites it.)
//
// CommonJS on purpose: as an ESM main script (.mjs) `await app.whenReady()`
// never resolves under Electron 43 and the process hangs forever.
//
// Run with: npm run icon   (after editing build/icon.svg)

const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SIZE = 1024

const root = join(__dirname, '..')
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

// Never hang: without a guard a window that never paints would keep the
// Electron process alive forever, e.g. in CI.
const timeout = setTimeout(() => fail('timed out waiting for the rendered frame'), 30_000)

app
  .whenReady()
  .then(async () => {
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

    window.webContents.once('paint', (_event, _dirty, image) => {
      const { width, height } = image.getSize()
      if (width !== SIZE || height !== SIZE) {
        fail(`painted ${width}x${height}, expected ${SIZE}x${SIZE}`)
        return
      }

      clearTimeout(timeout)
      writeFileSync(pngPath, image.toPNG())
      console.log(`[render-icon] wrote ${pngPath} (${width}x${height})`)
      app.exit(0)
    })

    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
  })
  .catch((error) => fail(error instanceof Error ? error.message : String(error)))
