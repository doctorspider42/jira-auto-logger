// Regenerates the README screenshots: starts the release build in mock mode
// with WebView2's DevTools port open, drives the UI over the Chrome DevTools
// Protocol and captures each screen into screenshots/.
//
// Run with: npm run screenshots   (after `npx tauri build --no-bundle`)
// Windows only - it drives WebView2. Needs Node 22+ for the global WebSocket.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 9339
const OUT = process.env.JAL_SCREENSHOTS || 'screenshots'
const EXE = join('src-tauri', 'target', 'release', 'jira-auto-logger.exe')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const app = spawn(EXE, ['--mock'], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    // The screenshots show the theme itself, not whatever is behind the window.
    JAL_BACKDROP: 'none'
  },
  stdio: 'ignore'
})

async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = targets.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // Not listening yet.
    }
    await sleep(500)
  }
  throw new Error('The app did not open its DevTools port')
}

const ws = new WebSocket(await connect())
await new Promise((resolve) => ws.addEventListener('open', resolve))
let nextId = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  pending.get(message.id)?.(message)
  pending.delete(message.id)
})
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
/** Runs an async function body in the page and returns its value. */
const run = async (body) => {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); ${body} })()`,
    awaitPromise: true,
    returnByValue: true
  })
  return result.result?.result?.value
}
const shot = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(result.result.data, 'base64'))
  console.log(`saved ${name}.png`)
}
const waitForData = `for (let i = 0; i < 40 && document.querySelector('.spinner'); i++) await wait(250)`

try {
  mkdirSync(OUT, { recursive: true })
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false })
  // The extra second lets start-up effects finish (PS1's power-on flash).
  await run(`for (let i = 0; i < 40 && !document.querySelector('.calendar-grid'); i++) await wait(250); ${waitForData}; await wait(1500)`)

  // Calendar with a selected day in the panel. Clicked through the DevTools
  // input pipeline: synthetic DOM events race the real cursor, and a cursor
  // resting over the grid turned the click into a drag across several days.
  const point = await run(`
    const day = [...document.querySelectorAll('.calendar-day:not(.outside)')].find((d) => d.querySelectorAll('.calendar-entry').length > 2)
    const box = day.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + 12 }`)
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await sleep(60)
  }
  await sleep(300)
  await shot('calendar')

  // Day view of the same day.
  await run(`document.querySelector('.inspector-actions-row .btn').click(); await wait(400); ${waitForData}`)
  await shot('calendar-day')
  await run(`[...document.querySelectorAll('.segmented button')][0].click(); await wait(400)`)

  // New entries: context step for a free weekday, then the review.
  await run(`
    const free = [...document.querySelectorAll('.calendar-day:not(.outside):not(.weekend)')].reverse().find((d) => !d.querySelector('.calendar-entry'))
    free.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await wait(400)
    document.querySelectorAll('.wizard-pick input').forEach((input) => input.checked || input.click())
    await wait(200)
    const note = document.querySelector('.wizard-note textarea')
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setValue.call(note, 'Morning: finished the biometric login PR. Afternoon: pairing on the camera crash.')
    note.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(200)`)
  await shot('wizard-input')
  await run(`
    document.querySelector('.wizard-footer .btn-primary').click()
    for (let i = 0; i < 60 && !document.querySelector('.suggestion-row'); i++) await wait(250)
    await wait(300)`)
  await shot('wizard-suggestions')
  await run(`document.querySelector('.wizard-header .btn-icon').click(); await wait(300)`)

  for (const [index, name] of [
    [1, 'projects'],
    [2, 'reports'],
    [3, 'settings']
  ]) {
    await run(`document.querySelectorAll('.app-nav-item')[${index}].click(); await wait(700)`)
    await shot(name)
  }
} finally {
  ws.close()
  app.kill()
}
