import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { runScreenshotMode } from './screenshotMode'

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#111318',
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
  registerIpcHandlers()
  const window = createWindow()

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
