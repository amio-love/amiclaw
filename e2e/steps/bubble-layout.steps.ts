/**
 * Layout regression step for the companion greeting bubble vs the homepage
 * 今日清单 (re-audit F4). The floating greeting bubble reached up over the
 * checklist's actionable item rows on a phone; it must sit clear of them (the
 * bubble is capped to two lines and hugs the dock so a long greeting cannot grow
 * up into the rows).
 */
import { expect } from '@playwright/test'
import { Then } from './fixtures'

Then('the greeting bubble sits clear of the 今日清单 item rows', async ({ page }) => {
  const bubble = page.locator('[class*="bubbleLayer"]')
  await bubble.waitFor({ state: 'attached', timeout: 8000 })
  const result = await page.evaluate(() => {
    const layer = document.querySelector('[class*="bubbleLayer"]')
    if (!layer) return { ok: false, reason: 'no greeting bubble present' }
    const b = layer.getBoundingClientRect()
    const items = Array.from(document.querySelectorAll('[aria-label="今日清单"] a')).map((el) => {
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) }
    })
    if (items.length === 0) return { ok: false, reason: 'no 今日清单 item rows found' }
    // The bubble must sit entirely BELOW the actionable checklist rows: its top
    // edge is at or under every item's bottom.
    const covered = items.filter((it) => Math.round(b.top) < it.bottom)
    return { ok: covered.length === 0, bubbleTop: Math.round(b.top), items, covered }
  })
  expect(
    result.ok,
    `the greeting bubble overlaps checklist item rows: ${JSON.stringify(result)}`
  ).toBe(true)
})
