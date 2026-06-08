/** Atlas platform-shell steps — homepage hero, tabs, countdown, zone styling. */
import { expect } from '@playwright/test'
import { Given, When, Then } from './fixtures'

const NAV = '主导航'

/** Scan computed colors document-wide; report cyan elements outside #featured. */
async function cyanAudit(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const featured = document.querySelector('#featured')
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
    let insideZone = false
    const offenders: string[] = []
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const style = getComputedStyle(el)
      const cyan = props.some((p) => isCyan(style[p as keyof CSSStyleDeclaration] as string))
      if (!cyan) continue
      if (featured && featured.contains(el)) insideZone = true
      else offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`)
    }
    return { insideZone, offenders }
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
  await expect(page.getByText('关于 · WHAT IS AMICLAW')).toBeVisible()
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
    const text = (await page.locator('[class*="countdown"]').first().innerText()).replace(/\s/g, '')
    const parts = text.split(':').map((n) => Number(n))
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
      throw new Error(`unparseable countdown: "${text}"`)
    }
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
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
  await expect(page.getByText('关于 · WHAT IS AMICLAW')).toHaveCount(0)
  await expect(page.getByText('永久免费，不存档也不出售你的对话。')).toHaveCount(0)
})

Then(
  'I can still reach the daily challenge and the featured BombSquad section',
  async ({ page }) => {
    await expect(page.getByText('每日挑战 · DAILY DROP')).toBeVisible()
    await expect(page.locator('#featured')).toBeVisible()
  }
)

Then(
  'the BombSquad cyan accent appears only in the featured BombSquad art panel',
  async ({ page }) => {
    const { insideZone, offenders } = await cyanAudit(page)
    expect(insideZone, 'the featured BombSquad zone uses the cyan accent').toBe(true)
    expect(offenders, 'no cyan outside the featured zone').toEqual([])
  }
)

Then(
  'the platform chrome — top navigation, footer, daily-challenge card — uses no cyan',
  async ({ page }) => {
    const { offenders } = await cyanAudit(page)
    expect(offenders, 'platform chrome carries no cyan').toEqual([])
  }
)
