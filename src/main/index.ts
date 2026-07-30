import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { runScreenshotMode } from './screenshotMode'
import { TelemetryService } from './services/TelemetryService'

// Aptabase must be initialized before the app 'ready' event, so do it at module
// load - well before `whenReady` below. It sends nothing on its own; event
// reporting is gated on the opt-out setting once config is bound in the IPC
// layer.
const telemetry = new TelemetryService()
telemetry.init()

// Window/taskbar icon. Windows and macOS take the icon of a packaged app from
// the bundle itself, but dev runs and Linux need it passed explicitly. `build/`
// is electron-builder's buildResources directory and is never packaged into the
// app, so the packaged copy comes from `extraResources` instead.
function windowIcon(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'build', 'icon.png')
    : join(__dirname, '../../build/icon.png')
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 640,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#111318',
    icon: windowIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.on('ready-to-show', () => window.show())

  // External links go to the system browser, never into the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

app.whenReady().then(() => {
  const updates = registerIpcHandlers(telemetry)
  const window = createWindow()
  updates.start()
  telemetry.start()

  const screenshotDir = process.env.JAL_SCREENSHOTS
  if (screenshotDir) {
    window.webContents.once('did-finish-load', () => {
      void runScreenshotMode(window, screenshotDir)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
