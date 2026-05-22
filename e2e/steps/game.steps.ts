/** BombSquad game-flow steps — prompt modal, HUD, module solving, failure. */
import { expect, type Locator } from '@playwright/test'
import { Given, When, Then } from './fixtures'
import type { ModuleKind } from './fixtures'

const SCENE_BAR = '[aria-label="场景信息栏"]'
const MODULE_LABEL: Record<string, ModuleKind> = {
  线路: 'wire',
  密码盘: 'dial',
  按钮: 'button',
  键盘: 'keypad',
}

function mmssToSeconds(text: string): number {
  const [m, s] = text.trim().split(':').map(Number)
  return m * 60 + s
}

/** The 暗号 (tongue-twister) value cell inside the SceneInfoBar. */
function sceneValue(page: import('@playwright/test').Page, index: number): Locator {
  return page.locator(`${SCENE_BAR} [class*="value"]`).nth(index)
}

// --- Prompt modal entry ------------------------------------------------------

When('I click a daily-challenge CTA', async ({ world }) => {
  await world.openDailyModal()
})

When('I click the featured BombSquad "练习" CTA', async ({ world }) => {
  await world.openPracticeModal()
})

Then('a prompt modal opens with the daily manual URL', async ({ page }) => {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/\/manual\//)).toBeVisible()
})

Then('the prompt modal opens with the practice manual URL', async ({ page }) => {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/\/manual\/practice/)).toBeVisible()
})

Then('a prompt modal opens for practice mode', async ({ page }) => {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('练习 Prompt')).toBeVisible()
})

Then('the modal stays within the viewport without horizontal overflow', async ({ page }) => {
  const box = await page.getByRole('dialog').boundingBox()
  const width = page.viewportSize()?.width ?? 0
  expect(box).not.toBeNull()
  if (box) {
    expect(box.x).toBeGreaterThanOrEqual(-1)
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

When('I confirm the modal with "确认开始游戏"', async ({ world }) => {
  await world.confirmModal()
})

// --- Game HUD ----------------------------------------------------------------

Then('the immersive game flow renders without the platform shell', async ({ page }) => {
  await expect.poll(() => new URL(page.url()).pathname).toBe('/game')
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
})

Then('I see the prompt {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text)).toBeVisible()
})

Then(
  /^the timer starts at the (daily|practice) budget (\d+:\d+) and counts down toward 00:00$/,
  async ({ world, page }, _mode: string, budget: string) => {
    const timer = page.getByRole('timer')
    await expect(timer).toHaveText(budget)
    await world.advance(3000)
    const after = mmssToSeconds(await timer.innerText())
    expect(after).toBeLessThan(mmssToSeconds(budget))
    expect(after).toBeGreaterThan(0)
  }
)

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

When(/^I solve the (线路|密码盘|按钮|键盘) module correctly$/, async ({ world }, label: string) => {
  await world.solveModule(MODULE_LABEL[label])
})

Then(
  /^the module progress bar advances to the (线路|密码盘|按钮|键盘) module$/,
  async ({ page }, label: string) => {
    await expect(page.getByText(label, { exact: true })).toBeVisible()
  }
)

Then('the result page shows the heading {string}', async ({ page }, text: string) => {
  await page.waitForURL(/\/result/, { timeout: 10_000 })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(text)
})

Then('the run is recorded as a successful completion', async ({ page }) => {
  await expect.poll(() => new URL(page.url()).pathname).toBe('/result')
  await expect(page.getByRole('heading', { name: '练习完成' })).toBeVisible()
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
  await expect.poll(() => new URL(page.url()).pathname).toBe('/game')
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
  await expect.poll(() => new URL(page.url()).pathname).toBe('/game')
})

Then('the run still continues', async ({ page }) => {
  await expect(page.getByRole('alert', { name: '炸弹爆炸' })).toHaveCount(0)
  await expect.poll(() => new URL(page.url()).pathname).toBe('/game')
})

When('the countdown timer reaches 00:00', async ({ world }) => {
  const budget = world.runMode === 'daily' ? 600_000 : 300_000
  await world.fastForwardPast(budget + 1_000)
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
  // Clear the 1.4s EXPLOSION_DURATION timer (harmless if already at /result).
  await world.advance(1600)
  await page.waitForURL(/\/result/, { timeout: 10_000 })
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

Then('it shows how many modules were completed this run', async ({ page }) => {
  await expect(page.getByText(/本次完成 \d+ 个模块/)).toBeVisible()
})

Then('the "再来一局" action is available', async ({ page }) => {
  await expect(page.getByRole('button', { name: '再来一局' })).toBeVisible()
})
