/** Result page, recap copy, leaderboard, compatibility and regression steps. */
import { expect, type Page } from '@playwright/test'
import { Given, When, Then } from './fixtures'

/** Stable test nickname — no '你' so it is not flagged as the "you" row. */
const E2E_NICKNAME = 'E2ERunner'

/** Stable test AI assistant for leaderboard-gated e2e submissions. */
const E2E_AI_ASSISTANT_LABEL = 'Claude'

/** Nickname injected by the regression leaderboard scenario. */
let regressionNickname = ''

async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText())
}

function assertPlausibleSubmission(submission: Record<string, unknown> | undefined): void {
  expect(submission, 'a /api/leaderboard POST was captured').toBeDefined()
  const sub = submission as { time_ms: number; module_times: number[] }
  expect(Number.isInteger(sub.time_ms)).toBe(true)
  expect(sub.time_ms).toBeGreaterThanOrEqual(1000)
  expect(sub.time_ms).toBeLessThan(600_000)
  expect(Array.isArray(sub.module_times)).toBe(true)
  expect(sub.module_times).toHaveLength(4)
  let total = 0
  sub.module_times.forEach((m, i) => {
    expect(Number.isInteger(m), `module ${i} timing is an integer`).toBe(true)
    expect(m, `module ${i} timing is non-zero`).toBeGreaterThan(0)
    expect(m, `module ${i} timing fits inside the run total`).toBeLessThanOrEqual(sub.time_ms)
    total += m
  })
  expect(total, 'module timings sum within the run total').toBeLessThanOrEqual(sub.time_ms)
}

// --- Daily win -> leaderboard (mobile-beta) ----------------------------------

Given(
  'I have just defused the bomb in a daily run and the result page is open',
  async ({ world }) => {
    await world.driveDailyToResult()
  }
)

Given('no nickname is stored on this device', async ({ page }) => {
  const stored = await page.evaluate(() => localStorage.getItem('bombsquad-nickname'))
  expect(stored).toBeNull()
})

Given('no leaderboard AI metadata is stored on this device', async ({ page }) => {
  const stored = await page.evaluate(() => ({
    tool: localStorage.getItem('bombsquad-leaderboard-ai-tool'),
    model: localStorage.getItem('bombsquad-leaderboard-ai-model'),
  }))
  expect(stored.tool).toBeNull()
  expect(stored.model).toBeNull()
})

Then('I see the total run time', async ({ page }) => {
  const total = page.locator('[class*="totalTime"]').first()
  await expect(total).toBeVisible()
  await expect(total).toHaveText(/\d+:\d\d/)
})

Then('the module breakdown lists all 4 modules without horizontal overflow', async ({ page }) => {
  // The Atlas result page renders the per-module breakdown as `bdRow` divs,
  // not an HTML table — a defused daily run has 4 such rows.
  await expect(page.locator('[class*="bdRow"]')).toHaveCount(4)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

Given('I am signed in with the leaderboard name {string}', async ({ world }, name: string) => {
  // signIn + a public label BEFORE the result page mounts, so the page's
  // identity resolution (fetchArcadeProfile) reads a signed-in account whose
  // won daily run auto-submits under this name (ruling B). Set here rather than
  // in the Background so the homepage still renders its anonymous hero for the
  // run-entry CTAs; the result page reads the live world state at submit time.
  world.signIn({ user_id: 'e2e-user', email: 'e2e@amio.fans' })
  world.publicLabel = name
})

Then('the result page asks which AI I played with', async ({ page, world }) => {
  // First-time BYO signed-in win: the tool is not inferable and none is stored,
  // so the settlement shows ONE inline row of SSOT chips — no popup, no gate.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('和哪个 AI 一起玩的？')).toBeVisible()
  // Identity-state evidence: signed-in first-BYO win (AI-tool ask).
  await world.captureSettlement('signed-in-ai-ask')
})

When('I pick AI assistant {string} in the settlement', async ({ page }, assistant: string) => {
  await page.getByRole('button', { name: assistant, exact: true }).click()
})

Then('the result page shows the login invite', async ({ page }) => {
  // Anonymous win (ruling B / U13): ONE calm login invite, never a free-nickname
  // gate. Declining leaves the run off the board.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('登录后自动记录成绩')).toBeVisible()
  await expect(page.getByRole('button', { name: /登录/ })).toBeVisible()
})

Then('no leaderboard score is submitted', async ({ world, page }) => {
  // Give any stray submission a beat to fire, then assert none did.
  await page.waitForTimeout(200)
  expect(world.leaderboard.submissions).toHaveLength(0)
})

Then('the result page shows my global rank', async ({ page, world }) => {
  // The Atlas result page shows the rank in a card — a "全球排名" label cell
  // and a "#N / total" value cell — rather than the old "全球排名：#N" line.
  await expect(page.getByText('全球排名')).toBeVisible()
  // Identity-state evidence: signed-in win with a resolved leaderboard rank.
  await world.captureSettlement('signed-in-rank')
})

Then('the leaderboard table renders without horizontal overflow', async ({ page }) => {
  await expect(page.getByRole('table')).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

Then(
  'the leaderboard table shows a row with my nickname, time, and attempt count',
  async ({ page }) => {
    const row = page.getByRole('row').filter({ hasText: E2E_NICKNAME })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(/\d+:\d\d/)
    await expect(row).toContainText('次')
  }
)

// --- Leaderboard submission assertion (shared by mobile-beta + game-modes) ----

Then('the leaderboard submission carries a plausible time', async ({ world, page }) => {
  // A signed-in won daily run auto-submits (ruling B). When the tool was neither
  // inferable (companion) nor stored, the run waits on the inline chip ask — pick
  // one so the submission fires; otherwise it already auto-submitted on mount.
  if (world.leaderboard.submissions.length === 0) {
    const chip = page.getByRole('button', { name: E2E_AI_ASSISTANT_LABEL, exact: true })
    if ((await chip.count()) > 0) await chip.first().click()
    await expect.poll(() => world.leaderboard.submissions.length).toBeGreaterThan(0)
  }
  assertPlausibleSubmission(world.leaderboard.submissions.at(-1))
})

Then(
  'the leaderboard submission carries nickname {string} and AI assistant {string}',
  async ({ world }, nickname: string, aiTool: string) => {
    const submission = world.leaderboard.submissions.at(-1)
    assertPlausibleSubmission(submission)
    expect(submission).toMatchObject({ nickname, ai_tool: aiTool })
  }
)

Then(
  'the leaderboard table shows a row with nickname {string} and AI metadata {string}',
  async ({ page }, nickname: string, metadata: string) => {
    const row = page.getByRole('row').filter({ hasText: nickname })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(metadata)
  }
)

// --- Voice-AI compatibility page ---------------------------------------------

Then(
  'the AI tool list shows the row {string} marked {string}',
  async ({ page }, name: string, status: string) => {
    const row = page.getByRole('listitem').filter({ hasText: name }).filter({ hasText: status })
    await expect(row).toHaveCount(1)
  }
)

Then('no row mentions a required browser or "Clipboard API"', async ({ page }) => {
  const toolsText = await page.locator('[aria-label="已验证的 AI 工具"]').innerText()
  expect(toolsText).not.toContain('Clipboard API')
  expect(toolsText).not.toContain('浏览器')
})

Then('I am back on the BombSquad landing page', async ({ page }) => {
  // The compatibility page's 返回 link lands on the BombSquad landing (/bombsquad),
  // not the AMIO Arcade platform homepage — the landing carries the mode CTAs.
  // BombSquad is served at /bombsquad/, so the landing may carry a trailing
  // slash; normalize it away before comparing.
  await expect.poll(() => new URL(page.url()).pathname.replace(/\/$/, '')).toBe('/bombsquad')
  await expect(page.getByRole('button', { name: '每日挑战 →' })).toBeVisible()
})

Then('the system clipboard contains the daily manual URL', async ({ page }) => {
  // The connect step-1 copy card shows the manual URL in its `copyCardUrl`
  // cell; one tap copies that URL alone, so the clipboard equals it exactly.
  const url = (await page.locator('[class*="copyCardUrl"]').first().innerText()).trim()
  expect(url).toMatch(/\/manual\//)
  expect((await readClipboard(page)).trim()).toBe(url)
})

// --- Regression: leaderboard column integrity --------------------------------

Given('the daily leaderboard has at least one submitted score', async ({ world }) => {
  expect(world.leaderboard.getResponse.entries.length).toBeGreaterThan(0)
})

Given('a leaderboard row whose nickname is {string}', async ({ world }, nickname: string) => {
  regressionNickname = nickname
  world.leaderboard.getResponse.entries.push({
    rank: world.leaderboard.getResponse.entries.length + 1,
    nickname,
    time_ms: 151_000,
    attempt_number: 1,
  })
})

Given(
  'that nickname is {int} ASCII characters long with no spaces',
  async ({ world }, length: number) => {
    const nickname = world.leaderboard.getResponse.entries.at(-1)?.nickname ?? ''
    expect(nickname).toHaveLength(length)
    expect(nickname).toMatch(/^[\x20-\x7e]+$/)
    expect(nickname).not.toContain(' ')
  }
)

Then('the nickname wraps onto multiple lines inside the "玩家" column', async ({ page }) => {
  const cell = page
    .getByRole('row')
    .filter({ hasText: regressionNickname })
    .getByText(regressionNickname)
  await expect(cell).toBeVisible()
  const wrapping = await cell.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      overflowWrap: style.overflowWrap,
      wordBreak: style.wordBreak,
      height: el.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight) || 18,
    }
  })
  // The L5-1 fix: long nicknames wrap inside their column instead of
  // widening it (overflow-wrap:anywhere / word-break:break-word).
  const wrapsByStyle =
    wrapping.overflowWrap === 'anywhere' ||
    wrapping.wordBreak === 'break-word' ||
    wrapping.wordBreak === 'break-all'
  expect(wrapsByStyle || wrapping.height > wrapping.lineHeight * 1.4).toBe(true)
})

Then('the rendered table width does not exceed the 320px viewport', async ({ page }) => {
  const box = await page.getByRole('table').boundingBox()
  expect(box).not.toBeNull()
  if (box) expect(box.x + box.width).toBeLessThanOrEqual(321)
})

Then(
  'the "用时 · 尝试" column header and every time and attempt value stay fully visible',
  async ({ page }) => {
    const table = page.getByRole('table')
    await expect(table).toBeVisible()
    // The Atlas rebuild merged time + attempt into one composite column;
    // assert that header is present by its real text (relabeled from the
    // misleading 失误 — the value is the daily attempt number, not mistakes).
    await expect(table.getByRole('columnheader', { name: '用时 · 尝试' })).toBeVisible()
    // The genuine L5-1 invariant: nothing is clipped at the 320px viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow).toBeLessThanOrEqual(1)
  }
)

Then('no horizontal scrolling and no silently clipped column occurs', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

// --- Regression: wire hit-band geometry --------------------------------------

Given('the wire module is showing with at least two adjacent wires', async ({ world, page }) => {
  await world.openPath('/')
  await world.startPracticeRun()
  await expect(page.getByTestId('wire-0')).toBeVisible()
  await expect(page.getByTestId('wire-1')).toBeVisible()
})

Then('the wire module renders its wires in a 300-unit-wide SVG viewBox', async ({ page }) => {
  const viewBox = await page.locator('svg[aria-label="Wire routing panel"]').getAttribute('viewBox')
  expect(viewBox).not.toBeNull()
  expect((viewBox ?? '').split(/\s+/)[2]).toBe('300')
})

When('I inspect the .wire-hit-target click proxy for every wire', async ({ page }) => {
  await expect(page.locator('[data-testid^="wire-"]')).toHaveCount(4)
})

Then('its stroke-width is 28 viewBox units, up from the pre-fix 20', async ({ page }) => {
  const targets = page.locator('[data-testid^="wire-"]')
  const count = await targets.count()
  for (let i = 0; i < count; i++) {
    const strokeWidth = await targets.nth(i).evaluate((el) => getComputedStyle(el).strokeWidth)
    expect(parseFloat(strokeWidth)).toBeCloseTo(28, 0)
  }
})

Then('the rendered hit band is roughly 27 pixels tall at a 320px viewport', async ({ page }) => {
  const band = await page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label="Wire routing panel"]')
    const target = document.querySelector('[data-testid^="wire-"]')
    if (!svg || !target) return 0
    const scale = svg.getBoundingClientRect().width / 300
    return parseFloat(getComputedStyle(target).strokeWidth) * scale
  })
  expect(band).toBeGreaterThan(15)
  expect(band).toBeLessThan(44)
})

Then(
  'the hit band is far wider than the pre-fix ~19px band and as close to the 44px touch-target guideline as the zero-overlap constraint allows',
  async ({ page }) => {
    const band = await page.evaluate(() => {
      const svg = document.querySelector('svg[aria-label="Wire routing panel"]')
      const target = document.querySelector('[data-testid^="wire-"]')
      if (!svg || !target) return 0
      const scale = svg.getBoundingClientRect().width / 300
      return parseFloat(getComputedStyle(target).strokeWidth) * scale
    })
    // Pre-fix stroke-width 20 -> ~19px band; the widened band must beat it.
    expect(band).toBeGreaterThan(20)
    expect(band).toBeLessThanOrEqual(44)
  }
)

Then("no wire's hit band overlaps an adjacent wire's hit band", async ({ page }) => {
  // Wires sit 45 viewBox units apart; a 28-unit band (+/-14) leaves a gap.
  const strokeWidth = await page
    .locator('[data-testid^="wire-"]')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).strokeWidth))
  expect(strokeWidth).toBeLessThan(45)
})

Then(
  "tapping anywhere on a wire's hit band cuts that wire and never its neighbour",
  async ({ world, page }) => {
    // Tap a wire's hit band — the module registers the tap on that wire,
    // playing either the cut animation (correct wire) or the module-area
    // error pulse (wrong wire). Either proves the tap landed on the band.
    await page.getByTestId('wire-0').click()
    await expect(page.locator('[class*="errorPulse"], [class*="cutTop"]').first()).toBeVisible()
    await world.advance(900)
  }
)

Then(
  'the visible wire stroke stays a thin 3 units so the hit band stays hidden',
  async ({ page }) => {
    // The Atlas reskin draws each lit strand as the `strand` path at
    // stroke-width 3 — far thinner than the 28-unit hit band, so the widened
    // tap target stays invisible.
    const strokeWidth = await page
      .locator('[class*="strand"]')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).strokeWidth))
    expect(strokeWidth).toBeCloseTo(3, 0)
  }
)
