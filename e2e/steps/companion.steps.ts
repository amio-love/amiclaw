/** mode② companion steps — the /me/companion setup flow, the persistent
    companion dock (伙伴坞), and the daily co-play entry default.
    Auth + the /api/companion* control plane are route-mocked in fixtures.ts
    (world.signIn + world.companion + the settings PUT capture), so these
    journeys run against the static build with no Workers runtime, exactly
    like the magic-link auth journey. */
import { expect, type Locator, type Page } from '@playwright/test'
import { Given, When, Then } from './fixtures'

const TEST_EMAIL = 'nova@amio.fans'

/** The dock — `<aside aria-label="伙伴坞">` renders as a complementary region. */
function companionDock(page: Page): Locator {
  return page.getByRole('complementary', { name: '伙伴坞' })
}

Given('I am a signed-in player without a companion', async ({ world }) => {
  // signIn() must precede navigation so the first session read is authenticated;
  // companion stays null so the read 404s and the onboarding form shows.
  world.signIn({ user_id: 'e2e-user', email: TEST_EMAIL })
  world.companion = null
})

Given(
  'I am a signed-in player with a companion named {string}',
  async ({ world }, name: string) => {
    // signIn() + a pre-existing companion BEFORE the first navigation, so the
    // dock renders from the first page load. voice-default = the auto-voice
    // login sequence runs (the fake-media flags auto-grant the mic request).
    world.signIn({ user_id: 'e2e-user', email: TEST_EMAIL })
    world.companion = {
      name,
      address_style: '',
      voice_id: 'companion-warm',
      profile_enabled: true,
      voice_posture: 'voice-default',
      created_at: '2026-06-30T00:00:00.000Z',
    }
  }
)

// --- Companion dock (伙伴坞) — auto-voice-on-login sequence ---------------------

When('I open the homepage with the microphone {word}', async ({ page, world }, outcome: string) => {
  const deny = outcome === 'denied'
  // Deterministically pin the mic outcome AND the text-first invariant. The
  // auto-voice sequence lands the greeting TEXT, waits 300ms, then calls
  // getUserMedia. This hook records whether the greeting text was already on
  // screen at that instant (`__micTextFirst`) and that the request happened
  // (`__micCalled`), then GRANTS or DENIES deterministically — no dependency on
  // Chromium's fake-permission UI. On GRANT it resolves a MINIMAL synthetic
  // stream rather than the real fake device (which hangs headless on the
  // homepage): the lobby session only needs the stream to open its WebSocket and
  // stream the greeting; the mic-capture AudioContext failing on the stub stream
  // is caught as a non-fatal mic-error and never blocks the greeting.
  //
  // Override MediaDevices.PROTOTYPE.getUserMedia (not the instance property):
  // `navigator.mediaDevices` is often undefined at document-start when the init
  // script runs, but the interface prototype is already present, so the override
  // lands regardless of when the instance is created.
  await page.addInitScript(`(() => {
      const proto = window.MediaDevices && window.MediaDevices.prototype;
      if (!proto || !proto.getUserMedia) return;
      proto.getUserMedia = function (c) {
        window.__micCalled = true;
        window.__micTextFirst = ((document.body && document.body.textContent) || '').indexOf('我在这') !== -1;
        ${
          deny
            ? "return Promise.reject(new DOMException('microphone denied', 'NotAllowedError'));"
            : "return Promise.resolve({ getTracks: function () { return [{ kind: 'audio', enabled: true, stop: function () {} }]; }, getAudioTracks: function () { return [{ kind: 'audio', enabled: true, stop: function () {} }]; } });"
        }
      };
    })()`)
  await world.openPath('/')
  // The arrival greeting text lands first (after the async memory fetch); wait
  // for it, then advance the fake clock past the auto-voice mic-request delay
  // (300ms) AND the greeting-bubble dwell (5s). Both are setTimeouts that the
  // seed-pinning `page.clock` (from openPath) freezes, so without advancing them
  // the permission request never fires and the dock never leaves 说话 (speaking)
  // for its resting state. The homepage has no seed dependency, so this is safe.
  await expect(page.getByText('我在这。今天的每日挑战等你。').first()).toBeVisible()
  await page.clock.runFor(6000)
})

Then('the arrival greeting text lands before the microphone is requested', async ({ page }) => {
  // The mic request fires (auto-voice step 3, after the clock nudge), and at the
  // instant it did, the arrival greeting text was already rendered — the ratified
  // "first impression is never blocked by the browser permission dialog" invariant.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __micCalled?: boolean }).__micCalled))
    .toBe(true)
  const textFirst = await page.evaluate(
    () => (window as unknown as { __micTextFirst?: boolean }).__micTextFirst
  )
  expect(textFirst).toBe(true)
})

Then(
  'the companion greets by voice with the streamed greeting as its live subtitle',
  async ({ page, world }) => {
    // Grant → the lobby voice session opens over the stubbed /ai-ws/lobby-* bridge
    // and streams the social lobby greeting; Option B makes the dock bubble the
    // live subtitle of what the companion is saying (replacing the instant text).
    await expect(page.getByText(world.voice.lobbyReply).first()).toBeVisible()
  }
)

Then(
  'the companion stays a quiet text presence and denied-remembered is persisted',
  async ({ page, world }) => {
    // Deny → posture transitions to denied-remembered; the dock lands muted (a
    // quiet text presence, never auto-requesting again) and the denial is
    // persisted to the account control plane.
    await expect(companionDock(page).getByText('阿澈在这（静音中）')).toBeVisible()
    await expect
      .poll(() => world.companionSettingsPuts.at(-1)?.voice_posture)
      .toBe('denied-remembered')
  }
)

When('I mute the companion from the dock control menu', async ({ page, world }) => {
  await companionDock(page)
    .getByRole('button', { name: `${world.companion?.name} 控制菜单` })
    .click()
  await page.getByRole('menuitem', { name: '静音' }).click()
})

Then(
  'the dock lands muted and quiet-remembered is persisted to the account',
  async ({ page, world }) => {
    const name = world.companion?.name ?? ''
    await expect(companionDock(page).getByText(`${name}在这（静音中）`)).toBeVisible()
    // The posture write reached the account control plane (PUT captured).
    await expect
      .poll(() => world.companionSettingsPuts.at(-1)?.voice_posture)
      .toBe('quiet-remembered')
  }
)

// --- Companion co-play entry (daily challenge default) --------------------------

When('I enter the daily challenge from the BombSquad landing', async ({ page, world }) => {
  // Signed-in homepage: the WelcomeStrip's 开始玩 CTA (no arrow — the anonymous
  // hero's 开始玩 → belongs to the signed-out variant) crosses into the
  // BombSquad SPA, then the landing's 每日挑战 CTA opens the connect flow.
  await page.getByRole('button', { name: '开始玩', exact: true }).click()
  await page.waitForURL((url) => new URL(url).pathname.replace(/\/$/, '') === '/bombsquad', {
    timeout: 12_000,
  })
  await world.openConnect('daily')
})

Then(
  'the co-play entry is the default and BYO is a low-key secondary link',
  async ({ page, world }) => {
    const name = world.companion?.name ?? ''
    // Co-play is the single default surface — no manual-copy step 1, no chooser.
    await expect(page.getByRole('button', { name: `和 ${name} 一起进入 →` })).toBeVisible()
    await expect(page.getByText('第 1/2 步')).toHaveCount(0)
    // BYO (mode①) is demoted to a low-key secondary link, still one tap away —
    // not a co-equal full-width alternative button (owner ruling).
    await expect(page.getByRole('button', { name: '自带 AI 手动对接' })).toBeVisible()
  }
)

When('I start the run together with {string}', async ({ page, world }, name: string) => {
  // Re-pin the clock to the seed instant before the run navigation, mirroring
  // finishConnectFlow(): GamePage's getRunSeed reads Date.now() on mount.
  await page.clock.setSystemTime(world.seedT)
  await page.getByRole('button', { name: `和 ${name} 一起进入 →` }).click()
  await page.waitForURL((url) => new URL(url).pathname === '/bombsquad/run', { timeout: 12_000 })
})

Then(
  'the run starts in mode② with the platform voice partner connected',
  async ({ page, world }) => {
    // partner=platform rode the handoff URL — the mode② opt-in signal.
    expect(new URL(page.url()).searchParams.get('partner')).toBe('platform')
    await world.waitForRunStarted()
    // The in-game voice panel mounted and its stubbed session produced the
    // AI-first greeting — the proof the co-play wire is live end to end. Since
    // #217 the companion's spoken words render EXACTLY ONCE, in the top in-game
    // subtitle strip (伙伴字幕), NOT re-rendered inside the panel (which keeps only
    // the connection / phase status). So the panel presence proves the mount and
    // the subtitle strip proves the streamed greeting.
    await expect(page.getByRole('region', { name: 'AI 语音伙伴' })).toBeVisible()
    await expect(page.getByRole('status', { name: '伙伴字幕' })).toHaveText(world.voice.reply)
  }
)

When('I open the companion onboarding page', async ({ world }) => {
  await world.openPath('/me/companion')
})

When('I name my companion {string} and pick a voice', async ({ page }, name: string) => {
  const main = page.getByRole('main')
  await main.getByLabel('名字').fill(name)
  // Pick the first voice option (represented by name + description, no audio).
  await main.getByRole('radio').first().click()
  await main.getByRole('button', { name: '认识你的伙伴' }).click()
})

Then('I see my companion {string}', async ({ page }, name: string) => {
  // The identity panel reads "你的伙伴 X" after the setup is read back.
  await expect(page.getByRole('main').getByText(name).first()).toBeVisible()
})

Then('revisiting onboarding shows my companion, not the setup form', async ({ page, world }) => {
  await world.openPath('/me/companion')
  const main = page.getByRole('main')
  // The identity is shown; the name input (the setup form) is gone — one
  // companion per account, no second-setup path.
  await expect(main.getByText('小光').first()).toBeVisible()
  await expect(main.getByLabel('名字')).toHaveCount(0)
})
