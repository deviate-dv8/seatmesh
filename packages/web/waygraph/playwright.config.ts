import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, '..')

/** Reuse an already-running dev hub on :3190 instead of booting :3191 test server. */
const reuseDevHub = process.env.SEATMESH_WG_REUSE === '1'
const baseURL = process.env.WAYGRAPH_BASE_URL ?? (reuseDevHub ? 'http://127.0.0.1:3190' : 'http://127.0.0.1:3191')

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: 'list',
  globalSetup: './scripts/global-setup.ts',
  webServer: reuseDevHub
    ? undefined
    : {
        command: 'npm run serve:waygraph',
        cwd: webRoot,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: /Ready in|Server address/,
      },
  use: {
    headless: true,
    baseURL,
    launchOptions: {
      executablePath: process.env.CHROME_PATH || process.env.CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
})
