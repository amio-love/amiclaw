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
 * The hands-free mode② voice panel opens the mic continuously and runs a client
 * VAD over the capture stream. Chromium's DEFAULT fake audio device emits a
 * ~0.13-RMS tone — well above the panel's 0.02 VAD speech threshold — which would
 * fire a spurious "player is speaking" turn + barge-in that wipes the AI greeting
 * the e2e asserts. Feeding the fake device a SILENT capture file keeps the
 * continuous mic deterministically quiet (RMS 0), so no player turn / barge-in
 * ever fires and only the AI-first greeting drives the asserted UI states. The
 * file is generated here (gitignored `.cache/`) and handed to Chromium via
 * `--use-file-for-fake-audio-capture`.
 */
const SILENT_MIC_WAV = join(process.cwd(), '.cache', 'e2e', 'fake-mic-silence.wav')

function writeSilentMicWav(file: string): void {
  const sampleRate = 16_000
  const dataBytes = sampleRate * 2 // 1s of mono 16-bit silence; Chromium loops it.
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buf.writeUInt16LE(2, 32) // block align
  buf.writeUInt16LE(16, 34) // bits per sample
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, buf)
}

// Only the main process writes the file (workers just reference the path); the
// guard mirrors mirrorGherkinToFeatures so concurrent worker loads don't race.
if (process.env.TEST_WORKER_INDEX === undefined) writeSilentMicWav(SILENT_MIC_WAV)

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
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The mode② hands-free voice-panel scenario needs a deterministic mic +
        // audio:
        //  - fake media: getUserMedia returns a synthetic mic stream and the
        //    permission prompt is auto-accepted, so the continuous capture works
        //    headless with no real device.
        //  - SILENT capture file: the panel runs a client VAD over the open mic;
        //    Chromium's default fake audio tone (~0.13 RMS) would cross the 0.02
        //    VAD threshold and fire a spurious player turn + barge-in that wipes
        //    the asserted AI greeting, so the fake device is fed a silent WAV
        //    (RMS 0) — the mic stays deterministically quiet and only the AI-first
        //    greeting drives the asserted UI states.
        //  - autoplay relaxation: the panel's TTS AudioContext can start without
        //    a user-gesture gate, so the "说话中" playback indicator fires and its
        //    `onended` lets the panel settle back to "聆听中" deterministically.
        // Harmless to every other scenario (none uses getUserMedia or Web Audio
        // assertions).
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${SILENT_MIC_WAV}`,
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
  webServer: {
    // Serve the assembled `pnpm build` artifact (packages/platform/dist — the
    // deploy root that hosts the platform shell at /, BombSquad under
    // /bombsquad/, and the Yijing Oracle under /oracle/). A plain `vite preview`
    // only does a single-root SPA history fallback, but BombSquad is a separate
    // BrowserRouter SPA: a hard load or reload of a deep route like
    // /bombsquad/result must fall back to the BombSquad index, not the platform
    // shell. scripts/preview-pages.mjs mirrors the production Cloudflare Pages
    // _redirects fallback exactly (real file first, then /bombsquad/* ->
    // bombsquad/index.html, else -> index.html), so the e2e tree behaves like
    // production. The artifact must already be built (`pnpm build` precedes e2e).
    command: 'node scripts/preview-pages.mjs packages/platform/dist',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
