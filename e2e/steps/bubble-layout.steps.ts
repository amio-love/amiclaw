/**
 * Layout regression step for the companion greeting vs the homepage 今日清单
 * (re-audit F4). The old floating greeting bubble reached up over the
 * checklist's actionable item rows on a phone. Post-batch②, the logged-in home
 * leads with the companion presence hosted INLINE in the welcome strip (the
 * 伙伴在场 shell region, normal document flow), so it sits above the checklist by
 * construction; this step keeps guarding that invariant against the new
 * structure — the presence region must stay clear of the actionable item rows.
 */
import { expect } from '@playwright/test'
import { Then } from './fixtures'

Then('the companion presence sits clear of the 今日清单 item rows', async ({ page }) => {
  const region = page.getByRole('region', { name: '伙伴在场' })
  await region.waitFor({ state: 'attached', timeout: 8000 })
  const result = await page.evaluate(() => {
    const presence = document.querySelector('[aria-label="伙伴在场"]')
    if (!presence) return { ok: false, reason: 'no companion presence region' }
    const b = presence.getBoundingClientRect()
    const items = Array.from(document.querySelectorAll('[aria-label="今日清单"] a')).map((el) => {
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) }
    })
    if (items.length === 0) return { ok: false, reason: 'no 今日清单 item rows found' }
    // The presence must sit entirely ABOVE the actionable checklist rows: its
    // bottom edge is at or over every item's top.
    const covered = items.filter((it) => Math.round(b.bottom) > it.top)
    return { ok: covered.length === 0, presenceBottom: Math.round(b.bottom), items, covered }
  })
  expect(
    result.ok,
    `the companion presence overlaps checklist item rows: ${JSON.stringify(result)}`
  ).toBe(true)
})
