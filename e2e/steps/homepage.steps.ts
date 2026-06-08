/** Atlas platform-shell steps — homepage hero, tabs, countdown, zone styling. */
import { expect } from '@playwright/test'
import { Given, When, Then } from './fixtures'

const NAV = '主导航'

/** Scan computed colors document-wide; report EVERY element painted cyan,
    including inside #featured. The homepage is fully de-cyaned — cyan is
    wire-only (DesignSystem.md §Brand / Hard Prohibition #1) — so any cyan
    anywhere on the page is an offender. */
async function cyanAudit(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const isCyan = (value: string | null): boolean => {
      if (!value) return false
      const m = value.match(/-?\d+(\.\d+)?/g)
      if (!m || m.length < 3) return false
      const [r, g, b] = m.map(Number)
      // --bs-cyan is #00ffff; alpha variants compute to the same r/g/b.
      return r <= 45 && g >= 195 && b >= 195 && Math.abs(g - b) <= 45
    }
    const props = [
      'color',
      'backgroundColor',
      'borderTopColor',
      'borderRightColor',
      'borderBottomColor',
      'borderLeftColor',
      'outlineColor',
      'fill',
      'stroke',
    ] as const
    const offenders: string[] = []
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const style = getComputedStyle(el)
      const cyan = props.some((p) => isCyan(style[p as keyof CSSStyleDeclaration] as string))
      if (cyan) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`)
    }
    return { offenders }
  })
}

/** Does the featured BombSquad zone paint anything brand yellow (--amio-yellow
    is #ffe53e = rgb(255, 229, 62))? The de-cyaned zone leans on the brand
    yellow wordmark accent, so this positively guards that the zone keeps a
    visible brand-yellow accent rather than going colourless. */
async function featuredUsesBrandYellow(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const featured = document.querySelector('#featured')
    if (!featured) return false
    const isBrandYellow = (value: string | null): boolean => {
      if (!value) return false
      const m = value.match(/-?\d+(\.\d+)?/g)
      if (!m || m.length < 3) return false
      const [r, g, b] = m.map(Number)
      // --amio-yellow is #ffe53e = rgb(255, 229, 62).
      return r >= 235 && g >= 205 && g <= 250 && b <= 120
    }
    const props = ['color', 'backgroundColor', 'fill', 'stroke'] as const
    for (const el of Array.from(featured.querySelectorAll('*'))) {
      const style = getComputedStyle(el)
      if (props.some((p) => isBrandYellow(style[p as keyof CSSStyleDeclaration] as string))) {
        return true
      }
    }
    return false
  })
}

Given('I am not signed in', async () => {
  // Default useAuth() state is signed-out; the Background `I open /` already
  // landed anonymous. Nothing to set up.
})

Given('I am signed in', async ({ world }) => {
  // useAuth() resolves signed-in from `?auth=in` (a kept dev affordance).
  await world.openPath('/?auth=in')
})

Given('I am on the homepage', async ({ page }) => {
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
})

// RegExp-registered: the literal step text contains `/`, special in
// Cucumber expressions.
When(/^the `\/` route renders$/, async ({ page }) => {
  await expect(page.getByRole('navigation', { name: NAV })).toBeVisible()
})

Then('I see the anonymous hero with the「开始玩 →」and「看看 BombSquad」CTAs', async ({ page }) => {
  await expect(page.getByRole('button', { name: '开始玩 →' })).toBeVisible()
  await expect(page.getByRole('button', { name: '看看 BombSquad' })).toBeVisible()
})

Then('I see the daily-challenge section', async ({ page }) => {
  await expect(page.getByText('每日挑战 · DAILY DROP')).toBeVisible()
})

Then('I see the featured BombSquad section', async ({ page }) => {
  await expect(page.locator('#featured')).toBeVisible()
})

Then('I see the "什么是 Amiclaw" section', async ({ page }) => {
  await expect(page.getByText('关于 · What is AmiClaw')).toBeVisible()
})

Then('I see the upcoming-games section', async ({ page }) => {
  await expect(page.getByText('即将上线 · IN ORBIT')).toBeVisible()
})

Then('I see the footer pitch', async ({ page }) => {
  await expect(page.getByText('永久免费，不存档也不出售你的对话。')).toBeVisible()
})

Then('the page is dark-only with no light-mode variant', async ({ page }) => {
  const luminance = await page.evaluate(() => {
    const read = (el: Element) => {
      const c = getComputedStyle(el).backgroundColor
      const m = c.match(/-?\d+(\.\d+)?/g)
      if (!m) return null
      const [r, g, b, a] = m.map(Number)
      if (a !== undefined && a === 0) return null
      return 0.299 * r + 0.587 * g + 0.114 * b
    }
    return read(document.body) ?? read(document.documentElement) ?? 0
  })
  expect(luminance).toBeLessThan(90)
})

Then(
  'the homepage does not scroll horizontally at a 375-pixel phone viewport',
  async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow).toBeLessThanOrEqual(1)
  }
)

Then('the top navigation shows the tabs 游戏, 排行榜, 社区, and 我的', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: NAV })
  for (const tab of ['游戏', '排行榜', '社区', '我的']) {
    await expect(nav.getByRole('link', { name: tab, exact: true })).toBeVisible()
  }
})

Then('the 游戏 tab is marked active', async ({ page }) => {
  await expect(
    page.getByRole('navigation', { name: NAV }).getByRole('link', { name: '游戏', exact: true })
  ).toHaveAttribute('aria-current', 'page')
})

When(/^I click the (\S+) tab$/, async ({ page }, tab: string) => {
  await page
    .getByRole('navigation', { name: NAV })
    .getByRole('link', { name: tab, exact: true })
    .click()
})

Then('the leaderboard page renders inside the platform shell', async ({ page }) => {
  await expect(page.getByRole('navigation', { name: NAV })).toBeVisible()
  await expect(page.getByText('排行榜 · LEADERBOARD')).toBeVisible()
})

Then('the community page renders inside the platform shell', async ({ page }) => {
  await expect(page.getByRole('navigation', { name: NAV })).toBeVisible()
  await expect(page.getByText('社区 · COMMUNITY')).toBeVisible()
})

Then('the account page renders inside the platform shell', async ({ page }) => {
  await expect(page.getByRole('navigation', { name: NAV })).toBeVisible()
  await expect(page.getByText('我的 · ACCOUNT')).toBeVisible()
})

Then('the homepage renders again', async ({ page }) => {
  await expect(page.getByRole('button', { name: '开始玩 →' })).toBeVisible()
})

Then(/^the daily-challenge section shows a countdown in 时 \/ 分 \/ 秒$/, async ({ page }) => {
  for (const unit of ['时', '分', '秒']) {
    await expect(page.getByText(unit, { exact: true }).first()).toBeVisible()
  }
  await expect(page.locator('[class*="countdown"]').first()).toBeVisible()
})

Then('the countdown counts down toward the next UTC 00:00 reset', async ({ world, page }) => {
  const readSeconds = async (): Promise<number> => {
    // The DailyCountdown primitive renders the `HH:MM:SS` digits and a
    // `时 / 分 / 秒` unit row inside the same container. Each digit/label sits in
    // its own flex-item span, so innerText puts them on separate lines and the
    // unit labels trail the digits (e.g. "11\n:\n59\n:\n59\n时\n分\n秒"). Strip
    // all whitespace first, then pull just the HH:MM:SS digit groups, ignoring
    // the trailing unit labels.
    const text = (await page.locator('[class*="countdown"]').first().innerText()).replace(/\s/g, '')
    const m = text.match(/(\d{1,2}):(\d{2}):(\d{2})/)
    if (!m) {
      throw new Error(`unparseable countdown: "${text}"`)
    }
    const [, h, min, s] = m.map(Number)
    return h * 3600 + min * 60 + s
  }
  const before = await readSeconds()
  await world.advance(3000)
  const after = await readSeconds()
  expect(after).toBeLessThan(before)
})

Then('I see the welcome strip greeting me by name', async ({ page }) => {
  await expect(page.getByText('你好，', { exact: false })).toBeVisible()
  await expect(page.getByText('星海').first()).toBeVisible()
})

Then('the welcome strip shows my streak, completed count, and weekly rank', async ({ page }) => {
  for (const label of ['连胜', '已完成', '本周排名']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
  }
})

Then('the anonymous hero is not shown', async ({ page }) => {
  await expect(page.getByRole('button', { name: '开始玩 →' })).toHaveCount(0)
})

Then('the "什么是 Amiclaw" section and the footer pitch are not shown', async ({ page }) => {
  await expect(page.getByText('关于 · What is AmiClaw')).toHaveCount(0)
  await expect(page.getByText('永久免费，不存档也不出售你的对话。')).toHaveCount(0)
})

Then(
  'I can still reach the daily challenge and the featured BombSquad section',
  async ({ page }) => {
    await expect(page.getByText('每日挑战 · DAILY DROP')).toBeVisible()
    await expect(page.locator('#featured')).toBeVisible()
  }
)

Then('no element on the homepage uses the BombSquad cyan accent', async ({ page }) => {
  // Whole-page guard: subsumes the prior "platform chrome carries no cyan"
  // check and additionally forbids cyan inside the featured BombSquad zone,
  // which was de-cyaned to the brand yellow / warm-cosmic treatment.
  const { offenders } = await cyanAudit(page)
  expect(offenders, 'the homepage is fully de-cyaned — cyan is wire-only').toEqual([])
})

Then('the featured BombSquad wordmark uses the brand yellow', async ({ page }) => {
  expect(
    await featuredUsesBrandYellow(page),
    'the featured BombSquad zone keeps a visible brand-yellow accent'
  ).toBe(true)
})
