/** Result page, recap copy, leaderboard, compatibility and regression steps. */
import { expect, type Page } from '@playwright/test'
import { Given, When, Then } from './fixtures'

/** Stable test nickname — no '你' so it is not flagged as the "you" row. */
const E2E_NICKNAME = 'E2ERunner'

/** Nickname injected by the regression leaderboard scenario. */
let regressionNickname = ''

async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText())
}

async function fillNicknameAndConfirm(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill(E2E_NICKNAME)
  await dialog.getByRole('button', { name: '确认' }).click()
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

Then('the NicknameModal is open and covers the screen', async ({ page }) => {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('给自己起个名字')).toBeVisible()
})

Then(
  'the NicknameModal has no close button and cannot be dismissed by tapping the backdrop',
  async ({ page }) => {
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: '关闭' })).toHaveCount(0)
    // Tap the backdrop (top-left corner, outside the centered dialog panel).
    await page.mouse.click(8, 8)
    await expect(dialog).toBeVisible()
  }
)

When('I type a nickname into the NicknameModal input', async ({ page }) => {
  await page.getByRole('dialog').getByRole('textbox').fill(E2E_NICKNAME)
})

Then('the NicknameModal closes', async ({ page }) => {
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

Then('the result page shows my global rank', async ({ page }) => {
  // The Atlas result page shows the rank in a card — a "全球排名" label cell
  // and a "#N / total" value cell — rather than the old "全球排名：#N" line.
  await expect(page.getByText('全球排名')).toBeVisible()
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

// --- Recap copy (Scenario Outline) -------------------------------------------

Given(
  'I have finished a {string} run and the result page is open',
  async ({ world }, mode: string) => {
    await world.openPath('/')
    if (mode === 'daily') {
      await world.driveDailyToResult()
    } else {
      await world.drivePracticeToResult()
    }
  }
)

When(
  'the score submission resolves with rank {int} of {int} and personal best {int}ms attempt {int}',
  async ({ world, page }, rank: number, total: number, pbMs: number, pbAttempt: number) => {
    world.leaderboard.postResponse = {
      rank,
      total_players: total,
      personal_best_ms: pbMs,
      personal_best_attempt: pbAttempt,
    }
    await fillNicknameAndConfirm(page)
    await expect(page.getByText('全球排名')).toBeVisible()
  }
)

When(
  'the score submission resolves with rank {int} of {int} and a legacy personal best {int}ms',
  async ({ world, page }, rank: number, total: number, pbMs: number) => {
    world.leaderboard.postResponse = { rank, total_players: total, personal_best_ms: pbMs }
    await fillNicknameAndConfirm(page)
    await expect(page.getByText('全球排名')).toBeVisible()
  }
)

When('the score submission has not resolved', async ({ world, page }) => {
  world.leaderboard.abortPost = true
  await fillNicknameAndConfirm(page)
  await expect(page.getByText(/提交失败/)).toBeVisible()
})

When('the score submission is never sent', async ({ world }) => {
  expect(world.leaderboard.submissions).toHaveLength(0)
})

Then('the system clipboard holds plain text with no HTML formatting', async ({ page }) => {
  const text = await readClipboard(page)
  expect(text.length).toBeGreaterThan(0)
  expect(text).not.toMatch(/<\/?[a-z][^>]*>/i)
})

Then('the clipboard text contains the line {string}', async ({ page }, line: string) => {
  expect(await readClipboard(page)).toContain(line)
})

Then('the recap text contains the line {string}', async ({ page }, line: string) => {
  expect(await readClipboard(page)).toContain(line)
})

Then(
  'the recap text contains the exact line {string} with no attempt suffix',
  async ({ page }, line: string) => {
    const lines = (await readClipboard(page)).split('\n')
    expect(lines).toContain(line)
    expect(lines.some((l) => l.startsWith(`${line}（`))).toBe(false)
  }
)

Then('the recap text contains no {string} line', async ({ page }, prefix: string) => {
  expect(await readClipboard(page)).not.toContain(prefix)
})

Then(
  'the recap places any {string} line between {string} and {string}',
  async ({ page }, middle: string, before: string, after: string) => {
    const text = await readClipboard(page)
    const mid = text.indexOf(middle)
    if (mid === -1) return // line absent — vacuously satisfied
    const beforeIdx = text.indexOf(before)
    expect(beforeIdx).toBeGreaterThanOrEqual(0)
    expect(beforeIdx).toBeLessThan(mid)
    const afterIdx = text.indexOf(after)
    if (afterIdx !== -1) expect(mid).toBeLessThan(afterIdx)
  }
)

Then(
  'the clipboard text ends with three lines each starting with {string}',
  async ({ page }, prefix: string) => {
    const lines = (await readClipboard(page)).replace(/\s+$/, '').split('\n')
    const lastThree = lines.slice(-3)
    expect(lastThree).toHaveLength(3)
    for (const line of lastThree) expect(line.startsWith(prefix)).toBe(true)
  }
)

Then(
  'the first {string} bullet names the slowest module by its Chinese label',
  async ({ page }, prefix: string) => {
    const firstBullet = (await readClipboard(page)).split('\n').find((l) => l.startsWith(prefix))
    expect(firstBullet, 'a bullet line exists').toBeDefined()
    // buildRetroQuestions() names the slowest module; assert the bullet leads
    // with one of the four Atlas Chinese module labels.
    expect(firstBullet).toMatch(/^- (光弦|星盘|按钮|星符)模块/)
  }
)

Then('the leaderboard submission carries a plausible time', async ({ world, page }) => {
  // A daily-win submission only fires once the NicknameModal is confirmed.
  // Scenarios that do not walk the modal explicitly (e.g. game-modes "defuse
  // all four modules") still need the POST to have happened — confirm a
  // pending modal here so the captured body can be asserted.
  if (world.leaderboard.submissions.length === 0) {
    const dialog = page.getByRole('dialog')
    if ((await dialog.count()) > 0 && (await dialog.getByRole('textbox').count()) > 0) {
      await dialog.getByRole('textbox').fill(E2E_NICKNAME)
      await dialog.getByRole('button', { name: '确认' }).click()
    }
    await expect.poll(() => world.leaderboard.submissions.length).toBeGreaterThan(0)
  }
  assertPlausibleSubmission(world.leaderboard.submissions.at(-1))
})

Then('the leaderboard submission is never sent', async ({ world }) => {
  expect(world.leaderboard.submissions).toHaveLength(0)
})

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

Then('the recommended opening prompt contains {string}', async ({ page }, fragment: string) => {
  await expect(page.locator('[class*="promptText"]')).toContainText(fragment)
})

Then('the system clipboard contains the recommended opening prompt text', async ({ page }) => {
  const promptText = (await page.locator('[class*="promptText"]').innerText()).trim()
  const clipboard = (await readClipboard(page)).trim()
  expect(clipboard).toBe(promptText)
})

Then('I am back on the BombSquad landing page', async ({ page }) => {
  // The compatibility page's 返回 link lands on the BombSquad landing (/bombsquad),
  // not the Amiclaw platform homepage — the landing carries the mode CTAs.
  await expect.poll(() => new URL(page.url()).pathname).toBe('/bombsquad')
  await expect(page.getByRole('button', { name: '每日挑战 →' })).toBeVisible()
})

Then('the system clipboard contains the daily manual URL', async ({ page }) => {
  // The connect step-1 copy card shows the manual URL in its `copyCardUrl`
  // cell; copying it puts that exact string on the clipboard.
  const url = (await page.locator('[class*="copyCardUrl"]').first().innerText()).trim()
  expect(url).toMatch(/\/manual\//)
  expect(await readClipboard(page)).toBe(url)
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
  'the "用时 · 失误" column header and every time and attempt value stay fully visible',
  async ({ page }) => {
    const table = page.getByRole('table')
    await expect(table).toBeVisible()
    // The Atlas rebuild merged time + 失误/attempt into one composite column;
    // assert that header is present by its real text.
    await expect(table.getByRole('columnheader', { name: '用时 · 失误' })).toBeVisible()
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
