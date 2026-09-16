import { chromium, type Browser } from 'playwright'

/**
 * Playwright global setup:
 * 1. Wait until the Inertia/Vue app mounts (vite dev can lag HTTP 200).
 * 2. Resolve SEATMESH_WG_SESSION_ID from registry when unset.
 */
export default async function globalSetup() {
  const baseURL = (process.env.WAYGRAPH_BASE_URL ?? 'http://127.0.0.1:3191').replace(/\/$/, '')

  await waitForSpa(baseURL)

  if (process.env.SEATMESH_WG_SESSION_ID?.trim()) {
    return
  }

  const res = await fetch(`${baseURL}/sessions`, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`waygraph setup: GET ${baseURL}/sessions -> ${res.status}`)
  }

  const html = await res.text()
  const match = html.match(/"id":"([a-f0-9]+)"/)
  if (!match?.[1]) {
    throw new Error(
      'waygraph setup: no sessions in registry. Start a mesh session or set SEATMESH_WG_SESSION_ID.'
    )
  }

  process.env.SEATMESH_WG_SESSION_ID = match[1]
}

async function waitForSpa(baseURL: string, maxMs = 180_000) {
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || process.env.CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    const deadline = Date.now() + maxMs
    let lastErr = ''

    while (Date.now() < deadline) {
      try {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 15_000 })
        const main = await page.locator('#main').innerText().catch(() => '')
        const appHtml = await page.locator('#app').innerHTML().catch(() => '')
        if (main.trim().length > 0 && appHtml.length > 500) {
          return
        }
        lastErr = `main=${main.length} app=${appHtml.length}`
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
      await page.waitForTimeout(2000)
    }

    throw new Error(`waygraph setup: hub SPA not ready at ${baseURL} (${lastErr})`)
  } finally {
    await browser?.close()
  }
}
