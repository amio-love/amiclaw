/**
 * Shared playwright-bdd fixtures for the amiclaw e2e harness.
 *
 * Implements the verified 6-D harness-side determinism design — zero
 * `packages/game-bombsquad` product changes. Four mechanisms live here:
 *
 *  1. Controlled clock — `pinClockOnLanding` runs the canonical
 *     `clock.install({time:T-BUF})` -> `goto('/')` -> `clock.pauseAt(T)`
 *     recipe so the run-seed (`getRunSeed()` === `Date.now()`, both daily and
 *     practice — practice re-randomizes per run under its fixed manual) is
 *     pinned to exactly `T`. The seed-reading `/bombsquad/run` route is
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
const ARCADE_PROFILE_TODAY = new Date(ANSWERS.seed).toISOString().slice(0, 10)

function emptyArcadeProfile(profileId?: string) {
  return {
    ...(profileId ? { profile_id: profileId } : {}),
    last_activity_at: null,
    today_played: false,
    counts: { bombsquad_runs: 0, oracle_signs: 0 },
    bombsquad: { recent: null, best_daily: null, best_practice: null },
    oracle: { recent: null },
    daily_loop: {
      date: ARCADE_PROFILE_TODAY,
      checklist: {
        bombsquad_daily: { completed: false, completed_at: null },
        oracle_sign: { completed: false, completed_at: null },
      },
      streak: {
        today_completed: false,
        current_days: 0,
        longest_days: 0,
        last_active_date: null,
      },
    },
  }
}

// --- Voice-session stub ------------------------------------------------------
//
// The mode② voice panel connects to the platform-ai bridge over the same-origin
// `/ai-ws/*` WebSocket. The harness mocks that socket (page.routeWebSocket) so
// the panel is driven deterministically with no live Worker / provider. The
// AI-first opening greeting streams one text chunk then one audio chunk; the
// audio is a few seconds of PCM16 16 kHz mono silence — long enough that the
// "说话中" (speaking) indicator (which the hook drives off Web Audio playback) is
// observable, then short enough that its `onended` lets the panel settle back to
// "聆听中" (listening) well within the assertion window.
const VOICE_REPLY_TEXT = '把红色的线接到第三个接线柱，先别动其它线。'
/** PCM16 mono @16 kHz; the hook plays it back to set the "speaking" indicator. */
const VOICE_AUDIO_SECONDS = 3
const VOICE_AUDIO_BASE64 = Buffer.alloc(16_000 * VOICE_AUDIO_SECONDS * 2).toString('base64')

interface VoiceMockState {
  /** The AI's stubbed text reply rendered by the panel for the opening greeting. */
  reply: string
  /** Base64 PCM16 16 kHz mono TTS payload streamed as the turn's audio. */
  audioBase64: string
  /** Captured client->server JSON frames (create / turn / end) for assertions. */
  clientFrames: Record<string, unknown>[]
}

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
  /** Per-date GET boards for the date-navigation journey. When set, a GET with
   *  `?date=D` resolves to `boardsByDate[D]` (missing dates -> empty board);
   *  when null (the default) every GET returns `getResponse` unchanged. */
  boardsByDate: Record<string, LeaderboardEntry[]> | null
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
  /** Session identity returned by the mocked GET /api/auth/session, or null for
   *  the anonymous state. Set by `signIn` before the first navigation. */
  authIdentity: { user_id: string; email: string } | null = null
  /** Captured POST /api/auth/magic-link/request bodies for assertions. */
  readonly magicLinkRequests: Record<string, unknown>[] = []
  /** The route-mocked companion identity, or null for "not set up yet". POST
   *  /api/companion/setup creates it; GET /api/companion reflects it. */
  companion: {
    name: string
    address_style: string
    voice_id: string
    profile_enabled: boolean
    created_at: string
  } | null = null
  /** Stub config + captured frames for the mode② voice WebSocket. */
  readonly voice: VoiceMockState = {
    reply: VOICE_REPLY_TEXT,
    audioBase64: VOICE_AUDIO_BASE64,
    clientFrames: [],
  }
  private clockInstalled = false

  constructor(page: Page) {
    this.page = page
    this.leaderboard = {
      getResponse: structuredClone(LEADERBOARD_DEFAULT.get),
      postResponse: structuredClone(LEADERBOARD_DEFAULT.post),
      abortPost: false,
      submissions: [],
      boardsByDate: null,
    }
  }

  /** Mark this test as signed in BEFORE the first navigation. The real useAuth
   *  reads GET /api/auth/session (route-mocked in the fixture wiring); setting
   *  this makes that mock return an authenticated identity. Replaces the retired
   *  `?auth=in` dev mock, which is compiled out of the production build the e2e
   *  harness serves. */
  signIn(identity: { user_id: string; email: string }): void {
    this.authIdentity = identity
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
   *  (`/bombsquad/`, with a trailing slash). Accept both forms.
   *  Uses the AnonHero primary CTA「开始玩 →」(its exact label). The TopNav no
   *  longer carries a play button — its signed-out slot is now the 登录 / 注册
   *  auth entry — so the hero CTA is the only「开始玩」on the page. */
  async enterBombSquadLanding(): Promise<void> {
    await this.page.getByRole('button', { name: '开始玩 →' }).click()
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

  /**
   * Connect step 1 — click the primary copy CTA and wait for its copied state.
   * The most prominent element (the bottom 复制手册 CTA) and the URL card above
   * both share the same copy/fallback action.
   */
  async copyManualLink(): Promise<void> {
    await this.page.getByRole('button', { name: '复制手册', exact: true }).click()
    await this.page.getByText('已复制到剪贴板').first().waitFor()
  }

  /**
   * Connect steps 1→2→run. The primary CTA itself performs the copy, so step 1
   * is already in its copied state. The redundant manual 下一步 control was
   * removed — step 2 is now reached only via the post-copy 700ms auto-advance
   * effect. The controlled clock is paused, so fire that timer explicitly with
   * advance(700); that also pushes Date.now() to seedT+700, so re-pin the clock
   * back to seedT with setSystemTime (which fires no timers and keeps the clock
   * paused) before the run navigation — otherwise GamePage's getRunSeed reads a
   * shifted Date.now() and generates a puzzle that no longer matches
   * answers.json. Step 2 ends with a plain 进入游戏 navigation; the run then
   * auto-starts on the GamePage side (no separate 开始 gate any more). Assumes
   * the manual link is already copied.
   */
  async finishConnectFlow(): Promise<void> {
    await this.advance(700)
    await this.page.getByText('第 2/2 步').first().waitFor()
    await this.page.clock.setSystemTime(this.seedT)
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

  /**
   * Wait out the route-mocked manual load until the run auto-starts. There is
   * no 开始 gate any more: GamePage dispatches START_GAME the instant the manual
   * loads (READY), so PLAYING is reached on its own. The running stopwatch
   * (role=timer) is the observable proof the run entered PLAYING.
   */
  async waitForRunStarted(): Promise<void> {
    await this.page.getByRole('timer').waitFor({ state: 'visible', timeout: 12_000 })
  }

  async startDailyRun(): Promise<void> {
    await this.enterConnect('daily')
    await this.runConnectFlow()
    await this.waitForRunStarted()
  }

  async startPracticeRun(): Promise<void> {
    await this.enterConnect('practice')
    await this.runConnectFlow()
    await this.waitForRunStarted()
  }

  /**
   * Enter a mode② daily run with the platform voice partner. The voice panel
   * mounts only on a daily run opted in via `?partner=platform` (there is no
   * connect-flow affordance for it yet — it is a pure URL signal), so the run is
   * reached by a direct deep-link goto. The seed-pinning clock installed by the
   * preceding `I open /` step stays frozen across this navigation, so GamePage
   * mounts under the pinned daily seed exactly as a connect-flow entry would,
   * and the route-mocked manual loads the same fixture. PLAYING (the visible
   * stopwatch) implies the manual loaded, so the VoicePanel is mounted and its
   * `/ai-ws/*` socket — stubbed in the fixture wiring — is connecting.
   */
  async startPlatformVoiceDailyRun(): Promise<void> {
    this.runMode = 'daily'
    await this.page.goto('/bombsquad/run?mode=daily&partner=platform')
    await this.waitForRunStarted()
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

      // Auth session read (useAuth). Returns the authenticated identity once a
      // scenario calls world.signIn(...), else the anonymous 200. The real
      // backend always answers 200 (asking "am I logged in?" is legal), so the
      // mock mirrors that — never a 401.
      await page.route('**/api/auth/session', async (route) => {
        const body = world.authIdentity
          ? { authenticated: true, identity: world.authIdentity }
          : { authenticated: false, identity: null }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Cache-Control': 'no-store' },
          body: JSON.stringify(body),
        })
      })

      // Magic-link request — capture the POST body and return the unified
      // anti-enumeration response (the same body the real endpoint sends in
      // every branch). No email is actually sent in e2e.
      await page.route('**/api/auth/magic-link/request', async (route) => {
        const request = route.request()
        if (request.method() === 'POST') {
          try {
            world.magicLinkRequests.push(request.postDataJSON())
          } catch {
            /* body not JSON — ignore */
          }
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            message: 'If that email can sign in, a link is on its way.',
          }),
        })
      })

      // Arcade profile — the static-build harness has no D1 or auth cookie
      // runtime. Signed-in scenarios get an honest empty account profile; signed-
      // out scenarios get the same 401 shape as production.
      await page.route('**/api/arcade/profile**', async (route) => {
        if (!world.authIdentity) {
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'unauthorized' }),
          })
          return
        }

        const request = route.request()
        const emptyProfile = emptyArcadeProfile(world.authIdentity.user_id)

        if (request.method() === 'POST' && request.url().includes('/claim')) {
          const body = request.postDataJSON() as {
            events?: Array<{ run?: { source_key?: string }; sign?: { source_key?: string } }>
          }
          const sourceKeys =
            body.events
              ?.map((event) => event.run?.source_key ?? event.sign?.source_key)
              .filter((key): key is string => typeof key === 'string') ?? []
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Cache-Control': 'no-store' },
            body: JSON.stringify({
              profile: emptyProfile,
              source_keys: sourceKeys,
              inserted: 0,
              public_profile: { claimed: true, public_label: 'Player E2E' },
            }),
          })
          return
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Cache-Control': 'no-store' },
          body: JSON.stringify({
            profile: emptyProfile,
            public_profile: { claimed: false, public_label: null },
          }),
        })
      })

      // Companion identity read (GET /api/companion). 404 until setup, then the
      // created identity. The static build has no Workers runtime, so the
      // companion control plane is route-mocked exactly like the auth session.
      await page.route('**/api/companion', async (route) => {
        if (world.companion === null) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            headers: { 'Cache-Control': 'no-store' },
            body: JSON.stringify({ error: 'no companion set up' }),
          })
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Cache-Control': 'no-store' },
          body: JSON.stringify(world.companion),
        })
      })

      // Companion setup (POST /api/companion/setup). Creates the one companion
      // (or 409 if one already exists — one companion per account).
      await page.route('**/api/companion/setup', async (route) => {
        const request = route.request()
        if (request.method() !== 'POST') {
          await route.fulfill({ status: 405, body: 'Method Not Allowed' })
          return
        }
        if (world.companion !== null) {
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'companion already exists' }),
          })
          return
        }
        const body = request.postDataJSON() as {
          name: string
          voice_id: string
          address_style?: string
        }
        world.companion = {
          name: body.name,
          address_style: body.address_style ?? '',
          voice_id: body.voice_id,
          profile_enabled: true,
          created_at: '2026-06-30T00:00:00.000Z',
        }
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ companion: world.companion }),
        })
      })

      // Daily/practice manual fetch -> fixture YAML.
      await page.route('**/manual/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'text/yaml', body: MANUAL_YAML })
      })

      // mode② voice bridge — mock the same-origin `/ai-ws/*` WebSocket the
      // hands-free VoicePanel hook opens. Inert for every non-voice scenario
      // (none opens that socket). Mock mode (no connectToServer) means Playwright
      // opens the page socket automatically, so the hook's `onopen` create
      // handshake runs. The stub mirrors the real session-do.ts envelope and its
      // AI-first turn model: on `create` it replies `created` and then immediately
      // streams the AI's opening greeting (one text chunk then one audio chunk,
      // `done` on the last) with NO client `turn` required — the deployed server
      // fires that opening turn itself via server-side VAD. Binary mic PCM frames
      // (the continuous hands-free capture) arrive here as Buffers and are ignored
      // — no STT runs. A client `turn` (the legacy no-op the hook still sends on a
      // VAD utterance-end) is captured for assertions and otherwise ignored; the
      // silent fake mic means it never actually fires. No `end`/`summary` is sent
      // because the panel has no end control; the session ends by panel teardown
      // on run exit.
      await page.routeWebSocket(/\/ai-ws\//, (ws) => {
        ws.onMessage((message) => {
          if (typeof message !== 'string') return // binary mic audio — ignore
          let frame: { type?: string }
          try {
            frame = JSON.parse(message) as { type?: string }
          } catch {
            return
          }
          world.voice.clientFrames.push(frame as Record<string, unknown>)
          if (frame.type === 'create') {
            // AI-first: `created`, then the opening greeting (text then audio,
            // `done` on the audio) with no client turn.
            ws.send(JSON.stringify({ type: 'created', sessionId: 'e2e-voice-session' }))
            ws.send(
              JSON.stringify({ type: 'chunk', kind: 'text', text: world.voice.reply, done: false })
            )
            ws.send(
              JSON.stringify({
                type: 'chunk',
                kind: 'audio',
                audio: world.voice.audioBase64,
                done: true,
              })
            )
          }
        })
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
        // Date-navigation journeys seed per-day boards; every other scenario
        // keeps the single default GET response regardless of `?date=`.
        const requestedDate = new URL(request.url()).searchParams.get('date')
        const body =
          world.leaderboard.boardsByDate && requestedDate
            ? {
                date: requestedDate,
                entries: world.leaderboard.boardsByDate[requestedDate] ?? [],
              }
            : world.leaderboard.getResponse
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        })
      })

      await use(world)
    },
    { auto: true },
  ],
})

export const { Given, When, Then } = createBdd(test)
