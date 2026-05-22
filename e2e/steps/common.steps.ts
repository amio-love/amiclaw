/** Shared navigation, viewport, URL and generic locator steps. */
import { expect, type Page } from '@playwright/test'
import { Given, When, Then } from './fixtures'

/** Click a button or link by its visible label, tolerant of ← / → affixes. */
export async function tapByLabel(page: Page, raw: string): Promise<void> {
  const text = raw.trim()
  const variants = [text]
  const noArrow = text.replaceAll('←', '').replaceAll('→', '').trim()
  if (noArrow && noArrow !== text) variants.push(noArrow)

  for (const exact of [true, false]) {
    for (const name of variants) {
      const locator = page
        .getByRole('button', { name, exact })
        .or(page.getByRole('link', { name, exact }))
      if ((await locator.count()) > 0) {
        await locator.first().click()
        return
      }
    }
  }
  // Fallback: match by visible text content rather than accessible name —
  // covers buttons whose aria-label differs from their label text.
  for (const name of variants) {
    const byText = page
      .getByRole('button')
      .filter({ hasText: name })
      .or(page.getByRole('link').filter({ hasText: name }))
    if ((await byText.count()) > 0) {
      await byText.first().click()
      return
    }
  }
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
    // The compatibility page's copy control is `copyBtn`; the result page's
    // post-game recap copy control is `copyLink` — match either.
    await expect(
      page.locator('[class*="copyBtn"]:visible, [class*="copyLink"]:visible')
    ).toHaveText(label, {
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
