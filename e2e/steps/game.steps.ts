/** BombSquad game-flow steps — connect-AI flow, HUD, module solving, failure. */
import { expect, type Locator } from '@playwright/test'
import { Given, When, Then } from './fixtures'
import type { ModuleKind } from './fixtures'

const SCENE_BAR = '[aria-label="场景信息栏"]'
// Atlas redesign module display names — 线路→光弦, 密码盘→星盘, 键盘→星符;
// the button module keeps 按钮. The internal ModuleKind ids are unchanged.
const MODULE_LABEL: Record<string, ModuleKind> = {
  光弦: 'wire',
  星盘: 'dial',
  按钮: 'button',
  星符: 'keypad',
}

function mmssToSeconds(text: string): number {
  const [m, s] = text.trim().split(':').map(Number)
  return m * 60 + s
}

/** The 暗号 (tongue-twister) value cell inside the SceneInfoBar. */
function sceneValue(page: import('@playwright/test').Page, index: number): Locator {
  return page.locator(`${SCENE_BAR} [class*="value"]`).nth(index)
}

// --- Connect-AI flow entry ---------------------------------------------------

When('I enter the daily challenge from the homepage', async ({ world }) => {
  await world.enterConnect('daily')
})

When('I enter practice mode from the homepage', async ({ world }) => {
  await world.enterConnect('practice')
})

Then('the connect-AI flow opens at step 1', async ({ page }) => {
  await expect.poll(() => new URL(page.url()).pathname).toBe('/bombsquad/connect')
  await expect(page.getByText('第 1/2 步').first()).toBeVisible()
})

Then('the copy card shows the daily manual URL', async ({ page }) => {
  await expect(page.locator('[class*="copyCardUrl"]').first()).toContainText(/\/manual\//)
})

Then('the copy card shows the practice manual URL', async ({ page }) => {
  await expect(page.locator('[class*="copyCardUrl"]').first()).toContainText('/manual/practice')
})

Then('the connect screen has no horizontal overflow', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

When('I copy the manual link', async ({ world }) => {
  await world.copyManualLink()
})

When('I finish the connect-AI flow', async ({ world }) => {
  await world.finishConnectFlow()
})

When('I complete the connect-AI flow', async ({ world }) => {
  await world.runConnectFlow()
})

// --- Game HUD ----------------------------------------------------------------

Then('the immersive game flow renders without the platform shell', async ({ page }) => {
  await expect.poll(() => new URL(page.url()).pathname).toBe('/bombsquad/run')
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
})

Then('the timer starts at 00:00 and counts up', async ({ world, page }) => {
  const timer = page.getByRole('timer')
  // A count-up stopwatch shows 00:00 at the start — not a per-mode budget a
  // countdown would have shown.
  await expect(timer).toHaveText('00:00')
  await world.advance(3000)
  const after = mmssToSeconds(await timer.innerText())
  // The elapsed display has increased away from zero (the run's score).
  expect(after).toBeGreaterThan(0)
})

Then('the SceneInfoBar shows the "暗号：" and "电池：" fields', async ({ page }) => {
  const bar = page.locator(SCENE_BAR)
  await expect(bar).toBeVisible()
  await expect(bar.getByText('暗号：')).toBeVisible()
  await expect(bar.getByText('电池：')).toBeVisible()
})

Then(
  'the SceneInfoBar shows the "暗号：" field with a non-empty Chinese phrase',
  async ({ page }) => {
    await expect(page.locator(SCENE_BAR).getByText('暗号：')).toBeVisible()
    const value = (await sceneValue(page, 0).innerText()).trim()
    expect(value.length).toBeGreaterThan(0)
    expect(value).toMatch(/[一-鿿]/)
  }
)

Then(
  'the "暗号：" value is one of the entries from the curated tongue-twister pool',
  async ({ world, page }) => {
    const value = (await sceneValue(page, 0).innerText()).trim()
    expect(world.answers.tonguePool).toContain(value)
  }
)

// Registered as a RegExp: the literal step text contains `/`, `{`, `}` which
// would otherwise be parsed as Cucumber-expression syntax.
Then(
  /^the "暗号：" value does not match the pattern \/\^\[A-Z0-9\]\{6\}\$\/$/,
  async ({ page }) => {
    const value = (await sceneValue(page, 0).innerText()).trim()
    expect(value).not.toMatch(/^[A-Z0-9]{6}$/)
  }
)

Then('the "暗号：" value contains no alphanumeric ASCII characters', async ({ page }) => {
  const value = (await sceneValue(page, 0).innerText()).trim()
  expect(value).not.toMatch(/[A-Za-z0-9]/)
})

Then(
  'the SceneInfoBar shows the "电池：" field with a number between 1 and 4',
  async ({ page }) => {
    await expect(page.locator(SCENE_BAR).getByText('电池：')).toBeVisible()
    const battery = Number((await sceneValue(page, 1).innerText()).trim())
    expect(battery).toBeGreaterThanOrEqual(1)
    expect(battery).toBeLessThanOrEqual(4)
  }
)

Then(
  'the tongue-twister phrase wraps inside the SceneInfoBar without overflowing the bar',
  async ({ page }) => {
    const bar = await page.locator(SCENE_BAR).boundingBox()
    const phrase = await sceneValue(page, 0).boundingBox()
    expect(bar).not.toBeNull()
    expect(phrase).not.toBeNull()
    if (bar && phrase) {
      expect(phrase.x + phrase.width).toBeLessThanOrEqual(bar.x + bar.width + 1)
    }
  }
)

Then('the "电池：" field and indicator chips remain visible on screen', async ({ page }) => {
  const width = page.viewportSize()?.width ?? 0
  await expect(page.locator(SCENE_BAR).getByText('电池：')).toBeVisible()
  const bar = await page.locator(SCENE_BAR).boundingBox()
  expect(bar).not.toBeNull()
  if (bar) expect(bar.x + bar.width).toBeLessThanOrEqual(width + 1)
})

Then('the module progress bar shows {int} segments', async ({ page }, count: number) => {
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', String(count))
})

Then('the module progress bar shows exactly {int} segments', async ({ page }, count: number) => {
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', String(count))
})

// --- Module solving ----------------------------------------------------------

When(/^I solve the (光弦|星盘|按钮|星符) module correctly$/, async ({ world }, label: string) => {
  await world.solveModule(MODULE_LABEL[label])
})

Then(
  /^the module progress bar advances to the (光弦|星盘|按钮|星符) module$/,
  async ({ page }, label: string) => {
    // The active module's name is shown in the GamePage module-label eyebrow
    // ("模块 2/4 · 星盘"); assert the eyebrow now carries the expected name.
    await expect(page.getByText(`· ${label}`).first()).toBeVisible()
  }
)

Then('the result page shows the heading {string}', async ({ page }, text: string) => {
  await page.waitForURL(/\/bombsquad\/result/, { timeout: 10_000 })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(text)
})

// --- Failure paths -----------------------------------------------------------

Given('I have started a daily challenge run', async ({ world }) => {
  await world.startDailyRun()
})

Given('I have started a practice run', async ({ world }) => {
  await world.startPracticeRun()
})

When('I submit a wrong answer on the current module', async ({ world }) => {
  await world.submitWrongWire()
  await world.advance(700)
})

When('I submit a wrong answer', async ({ world }) => {
  await world.submitWrongWire()
  await world.advance(700)
})

When('I submit a second wrong answer', async ({ world }) => {
  await world.submitWrongWire()
  await world.advance(700)
})

When('I submit a third wrong answer', async ({ world }) => {
  // The third strike detonates synchronously in the reducer — no clock needed.
  await world.submitWrongWire()
})

Then('a red error pulse plays over the module panel', async ({ page }) => {
  await expect(page.locator('[class*="errorPulse"]')).toBeVisible()
})

Then('no strike is counted and the run does not fail', async ({ page }) => {
  await expect(page.getByTestId('strike-pip')).toHaveCount(0)
  await expect(page.getByRole('alert', { name: '炸弹爆炸' })).toHaveCount(0)
  await expect.poll(() => new URL(page.url()).pathname).toBe('/bombsquad/run')
})

Then('I can immediately retry the same puzzle in place', async ({ page }) => {
  await expect(page.getByTestId('wire-0')).toBeVisible()
})

Then('one pip of the strike indicator lights up', async ({ page }) => {
  await expect(page.locator('[data-testid="strike-pip"][data-lit="true"]')).toHaveCount(1)
})

Then('a second strike pip lights up', async ({ page }) => {
  await expect(page.locator('[data-testid="strike-pip"][data-lit="true"]')).toHaveCount(2)
})

Then('the current module is not reset — the same puzzle stays on screen', async ({ page }) => {
  await expect(page.getByTestId('wire-0')).toBeVisible()
})

Then('the run continues in the PLAYING state', async ({ page }) => {
  await expect(page.getByRole('alert', { name: '炸弹爆炸' })).toHaveCount(0)
  await expect.poll(() => new URL(page.url()).pathname).toBe('/bombsquad/run')
})

Then('the run still continues', async ({ page }) => {
  await expect(page.getByRole('alert', { name: '炸弹爆炸' })).toHaveCount(0)
  await expect.poll(() => new URL(page.url()).pathname).toBe('/bombsquad/run')
})

When('the stopwatch reaches the 1-hour hard cap', async ({ world }) => {
  // Both modes share a 1-hour hard cap (TIME_BUDGET_MS). Reaching it fires
  // TIME_EXPIRED, which ends the run neutrally in either mode — never an
  // explosion. Time is a score, not a detonator.
  const HARD_CAP_MS = 3_600_000
  await world.fastForwardPast(HARD_CAP_MS + 1_000)
})

Then('a full-screen explosion animation plays over the bomb panel', async ({ page }) => {
  await expect(page.getByRole('alert', { name: '炸弹爆炸' })).toBeVisible()
})

Then('a full-screen explosion animation plays', async ({ page }) => {
  await expect(page.getByRole('alert', { name: '炸弹爆炸' })).toBeVisible()
})

Then('no explosion animation plays', async ({ page }) => {
  await expect(page.getByRole('alert', { name: '炸弹爆炸' })).toHaveCount(0)
})

Then('the result page opens with the heading {string}', async ({ world, page }, text: string) => {
  // Clear the 1.4s EXPLOSION_DURATION timer (harmless if already at /bombsquad/result).
  await world.advance(1600)
  await page.waitForURL(/\/bombsquad\/result/, { timeout: 10_000 })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(text)
})

Then('the failure reason reads {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text)).toBeVisible()
})

Then('no nickname modal appears', async ({ page }) => {
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

Then('no score is submitted to the leaderboard', async ({ world }) => {
  expect(world.leaderboard.submissions).toHaveLength(0)
})

Then('the "再来一局" action is available', async ({ page }) => {
  await expect(page.getByRole('button', { name: '再来一局' })).toBeVisible()
})
