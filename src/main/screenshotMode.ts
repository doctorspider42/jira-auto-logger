import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { logger } from './services/logger'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Dev tooling: with JAL_SCREENSHOTS=<dir> (mock mode), drives the UI and
 * captures a screenshot of every screen, then quits. Used to refresh the
 * README images deterministically.
 */
export async function runScreenshotMode(window: BrowserWindow, dir: string): Promise<void> {
  const outDir = resolve(process.cwd(), dir)
  mkdirSync(outDir, { recursive: true })

  const shot = async (name: string): Promise<void> => {
    const image = await window.webContents.capturePage()
    writeFileSync(join(outDir, `${name}.png`), image.toPNG())
    logger.info('screenshots', `captured ${name}.png`)
  }
  const js = (code: string): Promise<unknown> => window.webContents.executeJavaScript(code)
  const clickTab = (index: number): Promise<unknown> =>
    js(`document.querySelectorAll('.nav-tab')[${index}]?.click()`)

  try {
    // Let the calendar load the mock worklogs.
    await sleep(3000)
    await shot('calendar')

    await clickTab(1)
    await sleep(800)
    await shot('projects')

    await clickTab(2)
    await sleep(800)
    await shot('settings')

    await clickTab(0)
    await sleep(1200)

    // Open the wizard by clicking a mid-month weekday cell. The mouseup must
    // come a beat later: the calendar attaches its listener in an effect
    // after the mousedown re-render.
    await js(`(() => {
      const cells = [...document.querySelectorAll('.calendar-day:not(.outside):not(.weekend)')]
      const withEntries = cells.filter((c) => c.querySelector('.calendar-entry'))
      const cell = withEntries[Math.floor(withEntries.length / 2)] ?? cells[10]
      cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    })()`)
    await sleep(300)
    await js(`window.dispatchEvent(new MouseEvent('mouseup'))`)
    await sleep(800)
    // Select the first two projects and add a note to the first section.
    await js(`(() => {
      const chips = [...document.querySelectorAll('.modal .chip')]
      chips.slice(0, 2).forEach((c) => c.click())
    })()`)
    await sleep(400)
    await js(`(() => {
      const note = document.querySelector('.modal textarea')
      if (!note) return
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(note, 'Morning: finished the biometric login PR. Afternoon: pairing on the camera crash.')
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await sleep(300)
    await shot('wizard-input')

    // Generate suggestions with the mock LLM and capture the review step.
    await js(`[...document.querySelectorAll('.modal-footer .btn-primary')].at(-1)?.click()`)
    await sleep(6000)
    await shot('wizard-suggestions')
  } catch (e) {
    logger.error('screenshots', 'screenshot run failed', String(e))
  } finally {
    app.quit()
  }
}
