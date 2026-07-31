import { app, BrowserWindow, Menu, shell, Tray } from 'electron'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { runScreenshotMode } from './screenshotMode'
import { ConfigService } from './services/ConfigService'
import { TelemetryService } from './services/TelemetryService'
import { logger } from './services/logger'
import type { AppConfig } from '@shared/domain'
import { AUTO_LOGGER_CONFIRM_EVENT } from '@shared/ipc'

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

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
const configService = new ConfigService()

function createWindow(startHidden = false): BrowserWindow {
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

  window.on('ready-to-show', () => {
    if (!startHidden) window.show()
  })

  window.on('close', (event) => {
    if (!isQuitting && configService.get().autoLogger.minimizeToTray) {
      event.preventDefault()
      window.hide()
    }
  })
  window.on('minimize', () => {
    if (configService.get().autoLogger.minimizeToTray) {
      window.hide()
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

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
  mainWindow = window
  return window
}

function showMainWindow(): BrowserWindow {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return window
}

function configureTray(config: AppConfig): void {
  if (!config.autoLogger.minimizeToTray) {
    tray?.destroy()
    tray = null
    return
  }
  if (!tray) {
    tray = new Tray(windowIcon())
    tray.setToolTip('Jira Auto Logger')
    tray.on('double-click', () => showMainWindow())
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: config.language === 'pl' ? 'Pokaż Jira Auto Logger' : 'Show Jira Auto Logger',
        click: () => showMainWindow()
      },
      { type: 'separator' },
      {
        label: config.language === 'pl' ? 'Zakończ' : 'Quit',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
}

function applyDesktopConfig(config: AppConfig): void {
  configureTray(config)
  if (!app.isPackaged) return
  try {
    if (process.platform === 'linux') {
      configureLinuxAutostart(config.autoLogger.launchAtLogin)
    } else if (process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: config.autoLogger.launchAtLogin,
        path: process.execPath,
        args: ['--hidden']
      })
    } else {
      app.setLoginItemSettings({ openAtLogin: config.autoLogger.launchAtLogin })
    }
  } catch (error) {
    logger.error('desktop', 'could not update launch-at-login setting', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

function configureLinuxAutostart(enabled: boolean): void {
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(app.getPath('home'), '.config')
  const directory = join(configHome, 'autostart')
  const filePath = join(directory, 'jira-auto-logger.desktop')
  if (!enabled) {
    if (existsSync(filePath)) unlinkSync(filePath)
    return
  }
  mkdirSync(directory, { recursive: true })
  const executable = (process.env.APPIMAGE?.trim() || process.execPath).replaceAll('"', '\\"')
  writeFileSync(
    filePath,
    `[Desktop Entry]\nType=Application\nName=Jira Auto Logger\nExec="${executable}" --hidden\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`,
    'utf8'
  )
}

function requestAutoLoggerConfirmation(date: string): void {
  const window = showMainWindow()
  const send = (): void => window.webContents.send(AUTO_LOGGER_CONFIRM_EVENT, date)
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', send)
  else send()
}

app.whenReady().then(() => {
  const config = configService.get()
  applyDesktopConfig(config)
  const services = registerIpcHandlers(
    telemetry,
    configService,
    applyDesktopConfig,
    requestAutoLoggerConfirmation
  )
  const openedAtLogin =
    app.isPackaged &&
    (process.argv.includes('--hidden') ||
      (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin))
  const window = createWindow(Boolean(openedAtLogin && config.autoLogger.minimizeToTray))
  services.updates.start()
  services.autoLogger.start()
  telemetry.start()

  const screenshotDir = process.env.JAL_SCREENSHOTS
  if (screenshotDir) {
    window.webContents.once('did-finish-load', () => {
      void runScreenshotMode(window, screenshotDir)
    })
  }

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !configService.get().autoLogger.minimizeToTray) app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
})
