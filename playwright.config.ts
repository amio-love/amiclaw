import { defineConfig, devices } from '@playwright/test'
import { defineBddConfig } from 'playwright-bdd'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * playwright-bdd's bundled Gherkin parser (@cucumber/gherkin) rejects any
 * feature file whose path does not end in `.feature` or `.md`. The repo's
 * Round-1 scenario files are pinned to the `.gherkin` extension and must not
 * be edited, so the harness mirrors them — verbatim, content unchanged — into
 * `.features-mirror/` as `.feature` files on every run. The `.gherkin` files
 * remain the single source of truth; the mirror is a disposable build input.
 */
function mirrorGherkinToFeatures(srcDir: string, destDir: string): void {
  // Worker processes also load this config; only the main process (and bddgen)
  // should rebuild the mirror, otherwise concurrent rmSync calls race.
  if (process.env.TEST_WORKER_INDEX !== undefined) return
  rmSync(destDir, { recursive: true, force: true })
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (entry !== 'steps' && entry !== 'fixtures' && entry !== 'scripts') walk(full)
        continue
      }
      if (!entry.endsWith('.gherkin')) continue
      const rel = full.slice(srcDir.length + 1).replace(/\.gherkin$/, '.feature')
      const out = join(destDir, rel)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, readFileSync(full))
    }
  }
  walk(srcDir)
}

mirrorGherkinToFeatures('e2e', '.features-mirror')

/**
 * `tags: '@playwright'` is load-bearing: only `@playwright`-tagged scenarios
 * are turned into runnable specs, so `@simulation` scenarios (the out-of-scope
 * dual-agent layer) never need step definitions. Generated specs land in
 * `.features-gen/` (gitignored).
 */
const testDir = defineBddConfig({
  features: '.features-mirror/**/*.feature',
  steps: 'e2e/steps/**/*.ts',
  tags: '@playwright',
})

/**
 * The harness runs every scenario in a single chromium project. Narrow-viewport
 * scenarios set their own viewport through the `my viewport width is {int}
 * pixels` step (the Gherkin Backgrounds already encode 320 / 375 / 370 px), so
 * a separate device-emulation project would only double-run all 15 scenarios
 * without adding coverage.
 */
export default defineConfig({
  testDir,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Cap workers: the game scenarios drive full multi-module play-throughs and
  // contend for CPU + the single preview server when over-parallelised.
  workers: process.env.CI ? 2 : 4,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Serve the production `pnpm build` artifact (packages/game/dist) with SPA
    // history fallback so direct navigation to /leaderboard, /game, /result and
    // /compatibility resolves to index.html. `vite preview` defaults to
    // appType:'spa', which provides exactly that fallback.
    command: 'pnpm --filter game exec vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
