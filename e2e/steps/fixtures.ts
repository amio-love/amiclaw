/**
 * Shared playwright-bdd fixtures for the amiclaw e2e harness.
 *
 * Implements the verified 6-D harness-side determinism design — zero
 * `packages/game-bombsquad` product changes. Four mechanisms live here:
 *
 *  1. Controlled clock — `pinClockOnLanding` runs the canonical
 *     `clock.install({time:T-BUF})` -> `goto('/')` -> `clock.pauseAt(T)`
 *     recipe so the daily run-seed (`getRunSeed('daily')` === `Date.now()`)
 *     is pinned to exactly `T`. The seed-reading `/bombsquad/run` route is
 *     reached by in-app client-side navigation, so `GamePage` mounts under an
 *     already-frozen clock. `advance` / `fastForwardPast` step the clock.
 *  2. Route mocking — the manual, leaderboard and events network routes are
 *     intercepted so the static-build gate never makes a live call. The
 *     leaderboard and events POST handlers capture request bodies for
 *     assertions.
 *  3. Golden answers — `answers.json` (built by build-answers.mts) carries the
 *     mechanical answer for every module at seed `T`, so the harness plays a
 *     real, full play-through.
 *  4. Survey gating — the once-per-device PostGameModal survey flag is seeded
 *     as already-answered for every scenario except the `@survey-fresh` one,
 *     so the modal never interferes with non-survey result-page journeys.
 */
import { test as base, createBdd } from 'playwright-bdd'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// --- Fixture data ------------------------------------------------------------

export type ModuleKind = 'wire' | 'dial' | 'button' | 'keypad'

interface WireAnswer {
  type: 'wire'
  cutPosition: number
}
interface DialAnswer {
  type: 'dial'
  positions: number[]
}
interface ButtonAnswer {
  type: 'button'
  action: 'tap' | 'hold'
  releaseOnColor?: string
}
interface KeypadAnswer {
  type: 'keypad'
  sequence: number[]
}
export type ModuleAnswer = WireAnswer | DialAnswer | ButtonAnswer | KeypadAnswer

interface ModuleAnswerEntry {
  kind: ModuleKind
  answer: ModuleAnswer
}
interface RunScene {
  sceneTongueTwister: string
  batteryCount: number
  indicators: { label: string; lit: boolean }[]
}
interface RunFixture {
  scene: RunScene
  answers: ModuleAnswerEntry[]
}
interface AnswersFile {
  seed: number
  tonguePool: string[]
  daily: RunFixture
  practice: RunFixture
}

interface LeaderboardEntry {
  rank: number
  nickname: string
  time_ms: number
  attempt_number: number
  ai_tool?: string
  ai_model?: string
}
interface LeaderboardGetResponse {
  date: string
  entries: LeaderboardEntry[]
}
interface SubmitResponse {
  rank: number
  total_players: number
  personal_best_ms?: number
  personal_best_attempt?: number
}

const FIXTURES_DIR = resolve(process.cwd(), 'e2e/fixtures')

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, name), 'utf8')) as T
}

const ANSWERS: AnswersFile = readJson('answers.json')
const MANUAL_YAML = readFileSync(resolve(FIXTURES_DIR, 'daily-manual.yaml'), 'utf8')
const LEADERBOARD_DEFAULT = readJson<{ get: LeaderboardGetResponse; post: SubmitResponse }>(
  'leaderboard-default.json'
)

/** Buffer that comfortably exceeds the install -> goto -> pauseAt latency. */
const CLOCK_BUFFER_MS = 60_000
/** Countdown budgets — verbatim from store/game-context.tsx TIME_BUDGET_MS. */
export const TIME_BUDGET_MS = { daily: 600_000, practice: 300_000 } as const

// --- Leaderboard route state -------------------------------------------------

interface LeaderboardState {
  getResponse: LeaderboardGetResponse
  postResponse: SubmitResponse
  abortPost: boolean
  submissions: Record<string, unknown>[]
}

// --- World -------------------------------------------------------------------

/** Per-test shared state + run-driving helpers. */
export class World {
  readonly page: Page
  readonly answers = ANSWERS
  readonly seedT = ANSWERS.seed
  readonly leaderboard: LeaderboardState
  /** Captured `/api/events` POST bodies — `survey_submit` and friends. */
  readonly events: Record<string, unknown>[] = []
  runMode: 'daily' | 'practice' = 'daily'
  private clockInstalled = false

  constructor(page: Page) {
    this.page = page
    this.leaderboard = {
      getResponse: structuredClone(LEADERBOARD_DEFAULT.get),
      postResponse: structuredClone(LEADERBOARD_DEFAULT.post),
      abortPost: false,
      submissions: [],
    }
  }

  /** Canonical seed-pinning recipe: install before goto, pauseAt after. */
  async openPath(path: string): Promise<void> {
    if (!this.clockInstalled) {
      await this.page.clock.install({ time: this.seedT - CLOCK_BUFFER_MS })
      this.clockInstalled = true
    }
    await this.page.goto(path)
    await this.page.clock.pauseAt(this.seedT)
  }

  /** Advance the controlled clock, firing every timer due in the window. */
  async advance(ms: number): Promise<void> {
    await this.page.clock.runFor(ms)
  }

  /** Jump the controlled clock forward, firing each due timer at most once. */
  async fastForwardPast(ms: number): Promise<void> {
    await this.page.clock.fastForward(ms)
  }

  scene(): RunScene {
    return this.answers[this.runMode].scene
  }

  answerFor(kind: ModuleKind): ModuleAnswer {
    const entry = this.answers[this.runMode].answers.find((a) => a.kind === kind)
    if (!entry) throw new Error(`No ${kind} answer for ${this.runMode} run in answers.json`)
    return entry.answer
  }

  // --- Run-entry helpers -----------------------------------------------------
  //
  // The redesign replaced the old single PromptModal with a routed flow:
  //   platform homepage `/` → BombSquad landing `/bombsquad` → connect-AI flow
  //   `/bombsquad/connect` (two in-place steps) → run `/bombsquad/run`.
  // Every homepage BombSquad CTA shares one mode-agnostic target (`/bombsquad`);
  // the daily / practice choice is made on the BombSquad landing page.

  /** Homepage `/` → BombSquad landing `/bombsquad` via a homepage BombSquad CTA.
   *  BombSquad is now a separate SPA served at `/bombsquad/`, so crossing the app
   *  boundary is a full-page navigation that lands on the directory root
   *  (`/bombsquad/`, with a trailing slash). Accept both forms. */
  async enterBombSquadLanding(): Promise<void> {
    await this.page.getByRole('button', { name: '立即挑战 →' }).click()
    await this.page.waitForURL((url) => new URL(url).pathname.replace(/\/$/, '') === '/bombsquad', {
      timeout: 12_000,
    })
  }

  /** BombSquad landing `/bombsquad` → connect-AI flow `/bombsquad/connect?mode=…`. */
  async openConnect(mode: 'daily' | 'practice'): Promise<void> {
    this.runMode = mode
    const label = mode === 'daily' ? '每日挑战 →' : '练习'
    await this.page.getByRole('button', { name: label, exact: true }).click()
    await this.page.waitForURL((url) => new URL(url).pathname === '/bombsquad/connect', {
      timeout: 12_000,
    })
  }

  /** Homepage `/` → connect-AI flow `/bombsquad/connect?mode=…` in one hop. */
  async enterConnect(mode: 'daily' | 'practice'): Promise<void> {
    await this.enterBombSquadLanding()
    await this.openConnect(mode)
  }

  /** Connect step 1 — click the copy card and wait for its copied state. */
  async copyManualLink(): Promise<void> {
    await this.page.locator('button[class*="copyCard"]').first().click()
    await this.page.getByText('已复制到剪贴板').first().waitFor()
  }

  /**
   * Connect steps 1→2→run. The controlled clock is paused, so the post-copy
   * 700ms auto-advance to step 2 never fires — the step is advanced by an
   * explicit 下一步 click instead. The single readiness confirm was removed
   * (it now lives once on GamePage's 开始), so step 2 ends with a plain
   * 进入游戏 navigation. Assumes the manual link is already copied.
   */
  async finishConnectFlow(): Promise<void> {
    await this.page.getByRole('button', { name: '下一步 →' }).click()
    await this.page.getByText('第 2/2 步').first().waitFor()
    await this.page.getByRole('button', { name: '进入游戏 →' }).click()
    await this.page.waitForURL((url) => new URL(url).pathname === '/bombsquad/run', {
      timeout: 12_000,
    })
  }

  /** Walk the whole connect-AI flow: copy the manual link, then hand off. */
  async runConnectFlow(): Promise<void> {
    await this.copyManualLink()
    await this.finishConnectFlow()
  }

  /** READY -> PLAYING. The 开始 button waits out the route-mocked manual load. */
  async pressStart(): Promise<void> {
    await this.page.getByRole('button', { name: '开始', exact: true }).click()
  }

  async startDailyRun(): Promise<void> {
    await this.enterConnect('daily')
    await this.runConnectFlow()
    await this.pressStart()
  }

  async startPracticeRun(): Promise<void> {
    await this.enterConnect('practice')
    await this.runConnectFlow()
    await this.pressStart()
  }

  // --- Module solving --------------------------------------------------------

  /**
   * Solve one module with its golden answer, then drive the controlled clock
   * through the `onComplete` (<=800ms) and `NEXT_MODULE` (800ms) timers. The
   * `拆除成功` overlay between the two `runFor`s confirms React has committed
   * the MODULE_COMPLETE render, so the NEXT_MODULE timer is registered before
   * the second advance. After the last module the same chain reaches
   * /bombsquad/result.
   */
  async solveModule(kind: ModuleKind): Promise<void> {
    const answer = this.answerFor(kind)
    if (answer.type === 'wire') {
      await this.page.getByTestId(`wire-${answer.cutPosition}`).click()
    } else if (answer.type === 'dial') {
      for (let dial = 0; dial < answer.positions.length; dial++) {
        for (let click = 0; click < answer.positions[dial]; click++) {
          await this.page.getByTestId(`dial-${dial}-right`).click()
        }
      }
      await this.page.getByTestId('dial-confirm').click()
    } else if (answer.type === 'button') {
      // build-answers pins T so the daily button resolves to a plain tap.
      await this.page.getByTestId('big-button').click()
    } else {
      for (const cell of answer.sequence) {
        await this.page.getByTestId(`keypad-cell-${cell}`).click()
      }
    }
    await this.advance(1200)
    await this.page.getByText('拆除成功').waitFor({ state: 'visible', timeout: 8000 })
    await this.advance(1200)
  }

  /** Click a deliberately wrong wire (the wire module is module 0 both modes). */
  async submitWrongWire(): Promise<void> {
    const answer = this.answerFor('wire')
    const correct = answer.type === 'wire' ? answer.cutPosition : 0
    const wrong = (correct + 1) % 4
    await this.page.getByTestId(`wire-${wrong}`).click()
  }

  async driveDailyToResult(): Promise<void> {
    await this.startDailyRun()
    await this.solveModule('wire')
    await this.solveModule('dial')
    await this.solveModule('button')
    await this.solveModule('keypad')
    await this.page.waitForURL(/\/bombsquad\/result/, { timeout: 10_000 })
  }

  async drivePracticeToResult(): Promise<void> {
    await this.startPracticeRun()
    await this.solveModule('wire')
    await this.solveModule('keypad')
    await this.page.waitForURL(/\/bombsquad\/result/, { timeout: 10_000 })
  }
}

// --- Fixture wiring ----------------------------------------------------------

export const test = base.extend<{ world: World }>({
  // `auto` so route mocks + clipboard permissions are always installed before
  // the first step (hence before the first goto).
  world: [
    async ({ page, context }, use, testInfo) => {
      const world = new World(page)

      await context.grantPermissions(['clipboard-read', 'clipboard-write'])

      // Endgame-survey gating. PostGameModal shows a once-per-device survey on
      // the first result-page visit, gated by the `bombsquad-survey-answered`
      // localStorage flag (the exact key from packages/game-bombsquad/src/utils/
      // survey.ts). Every journey scenario that reaches /bombsquad/result would otherwise
      // trip the modal on its first game-end, so the flag is seeded as
      // already-answered by default. The dedicated result-page-survey scenario
      // carries the @survey-fresh tag to opt out of the seed so the modal
      // actually appears for it.
      if (!testInfo.tags.includes('@survey-fresh')) {
        await page.addInitScript(() => {
          try {
            window.localStorage.setItem('bombsquad-survey-answered', 'true')
          } catch {
            /* localStorage unavailable (private mode) — modal may show; rare in e2e */
          }
        })
      }

      // Daily/practice manual fetch -> fixture YAML.
      await page.route('**/manual/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'text/yaml', body: MANUAL_YAML })
      })

      // Fire-and-forget telemetry -> 200 stub. POST bodies are captured first
      // so scenarios can assert on emitted events (e.g. `survey_submit`); the
      // capture mirrors the leaderboard POST handler below.
      await page.route('**/api/events*', async (route) => {
        const request = route.request()
        if (request.method() === 'POST') {
          try {
            world.events.push(request.postDataJSON())
          } catch {
            /* body not JSON — ignore */
          }
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
      })

      // Leaderboard — GET returns fixture entries; POST captures the body and
      // returns the configured rank response (or aborts for the unresolved case).
      // The body is captured BEFORE a possible abort: an aborted POST was still
      // a real, plausible submission — only the response failed to resolve.
      await page.route('**/api/leaderboard*', async (route) => {
        const request = route.request()
        if (request.method() === 'POST') {
          try {
            world.leaderboard.submissions.push(request.postDataJSON())
          } catch {
            /* body not JSON — ignore */
          }
          if (world.leaderboard.abortPost) {
            await route.abort()
            return
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(world.leaderboard.postResponse),
          })
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(world.leaderboard.getResponse),
        })
      })

      await use(world)
    },
    { auto: true },
  ],
})

export const { Given, When, Then } = createBdd(test)
