import { defineConfig, devices } from '@playwright/test'

/**
 * Package-LOCAL Playwright config for the Botanical Garden probe (design §6 e2e).
 *
 * Deliberately standalone rather than wired into the repo-root e2e harness: that
 * harness is BDD/gherkin bound to `e2e/flow-inventory.yaml` (a 1:1 scenario ⟷
 * flow governance) and serves the ASSEMBLED platform build (packages/platform/dist),
 * not this standalone game app. A probe should not touch that governance or CI, so
 * this config drives the game-botanical Vite dev server directly. (Findings: if the
 * game ships inside the platform post-merge, these win/lose runs can migrate into
 * the root harness with a flow-inventory entry.)
 *
 * The runs use a CONTROLLED CLOCK: the app exposes `window.__botanicalAdvance(dtMs)`
 * only when `import.meta.env.DEV && ?e2e=1` (compiled out of production), and the
 * wall-clock decay loop is off in that mode — so decay is driven deterministically,
 * with NO real-time waits.
 */
const PORT = 5199
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    viewport: { width: 390, height: 844 }, // mobile-first target
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `${BASE_URL}/botanical/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
