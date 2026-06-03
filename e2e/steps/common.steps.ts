/** Shared navigation, viewport, URL and generic locator steps. */
import { expect, type Locator, type Page } from '@playwright/test'
import { Given, When, Then } from './fixtures'

/** How long the wait fallback lets a late-rendering control appear before
 * giving up. Bounded so a genuinely-absent target still fails promptly. */
const TAP_TARGET_TIMEOUT_MS = 8000

/** Click a button or link by its visible label, tolerant of ← / → affixes. */
export async function tapByLabel(page: Page, raw: string): Promise<void> {
  const text = raw.trim()
  const variants = [text]
  const noArrow = text.replaceAll('←', '').replaceAll('→', '').trim()
  if (noArrow && noArrow !== text) variants.push(noArrow)

  // Candidate locators in priority order: exact accessible-name, then inexact
  // accessible-name, then visible-text content (covers buttons whose aria-label
  // differs from their label text). Each candidate matches button OR link.
  // Built once and reused for both the fast path and the wait fallback.
  const candidates: Locator[] = []
  for (const exact of [true, false]) {
    for (const name of variants) {
      candidates.push(
        page.getByRole('button', { name, exact }).or(page.getByRole('link', { name, exact }))
      )
    }
  }
  for (const name of variants) {
    candidates.push(
      page
        .getByRole('button')
        .filter({ hasText: name })
        .or(page.getByRole('link').filter({ hasText: name }))
    )
  }

  const clickFirstPresent = async (): Promise<boolean> => {
    for (const locator of candidates) {
      // `count()` is instantaneous and non-auto-waiting, so this is the fast
      // path: click immediately when a match is already in the DOM.
      if ((await locator.count()) > 0) {
        await locator.first().click()
        return true
      }
    }
    return false
  }

  if (await clickFirstPresent()) return

  // Slow path: the control may render a beat late (e.g. the GamePage READY
  // "开始" button only paints after the LOADING→READY transition), so the
  // instantaneous count-check above can miss it. Wait — bounded — for any
  // candidate to become visible, then re-run the selection.
  let combined = candidates[0]
  for (const locator of candidates.slice(1)) combined = combined.or(locator)
  try {
    await combined.first().waitFor({ state: 'visible', timeout: TAP_TARGET_TIMEOUT_MS })
  } catch {
    throw new Error(`tap/click target not found: ${raw}`)
  }
  if (await clickFirstPresent()) return
  throw new Error(`tap/click target not found: ${raw}`)
}

Given(/^I open (\/\S*)$/, async ({ world }, path: string) => {
  await world.openPath(path)
})

When('my viewport width is {int} pixels', async ({ page }, width: number) => {
  const current = page.viewportSize()
  await page.setViewportSize({ width, height: current?.height ?? 760 })
})

Then(/^the URL path is (\/\S*)$/, async ({ page }, path: string) => {
  await expect.poll(() => new URL(page.url()).pathname).toBe(path)
})

Then(/^I am navigated to the URL path (\/\S*)$/, async ({ page }, path: string) => {
  await page.waitForURL((url) => new URL(url).pathname === path, { timeout: 12_000 })
})

Then(
  'the button label changes to {string} within {int} second',
  async ({ page }, label: string, seconds: number) => {
    // The compatibility page's copy control is `copyBtn`. (The result page's
    // recap-copy control was removed in the endgame-settlement rework.)
    await expect(page.locator('[class*="copyBtn"]:visible')).toHaveText(label, {
      timeout: (seconds + 1) * 1000,
    })
  }
)

Then('the query string carries {string}', async ({ page }, fragment: string) => {
  await expect.poll(() => page.url()).toContain(fragment)
})

When('I tap {string}', async ({ page }, label: string) => {
  await tapByLabel(page, label)
})

When('I click {string}', async ({ page }, label: string) => {
  await tapByLabel(page, label)
})

Then('I see a heading {string}', async ({ page }, text: string) => {
  await expect(page.getByRole('heading', { name: text }).first()).toBeVisible()
})

Then('I see the heading {string}', async ({ page }, text: string) => {
  // Tolerant of headings vs. prominent eyebrow text (e.g. "排行榜 · LEADERBOARD").
  // `visible: true` skips hidden matches such as the mobile-collapsed nav link.
  await expect(
    page
      .getByRole('heading', { name: text })
      .or(page.getByText(text))
      .filter({ visible: true })
      .first()
  ).toBeVisible()
})

Then('I see the subtitle {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text).first()).toBeVisible()
})

Then('I see the link {string}', async ({ page }, text: string) => {
  await expect(page.getByRole('link', { name: text }).first()).toBeVisible()
})

Then('I see the tip {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text).first()).toBeVisible()
})
