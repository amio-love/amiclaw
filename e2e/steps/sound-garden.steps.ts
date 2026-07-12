/** Sound Garden anon co-build journey steps. The /sound-garden/ single-screen SPA
 * plays fully client-side; with no platform worker the voice-eligibility probe
 * fails and the offline scripted partner runs, so these steps drive the real
 * engine + scripted brain through the DOM: seed → plants → synergizing rhythm
 * roots → bloom. `Given I open /sound-garden/` is the shared navigation step. */
import { expect } from '@playwright/test'
import { Then, When } from './fixtures'

/** Must match the anon partner's product debounce in `TriggerBus`. */
const PARTNER_DEBOUNCE_MS = 600

When('I start Sound Garden level {string}', async ({ page }, level: string) => {
  // The default role is the melody flower side, so the player plants melody and
  // the partner plants rhythm. Clicking the level button starts that run.
  await page.getByRole('button', { name: new RegExp(level) }).click()
  // The anon partner tier renders once eligibility resolves (no worker → anon):
  // the melody palette is the ready signal.
  await expect(page.getByRole('button', { name: /选择铃铛/ })).toBeVisible()
})

Then('the Sound Garden partner seeds the garden with an opening root', async ({ page }) => {
  // The scripted partner greets AND pre-seeds exactly one rhythm root (the PR-2
  // anon opening move), so the garden starts with one filled rhythm cell.
  await expect(page.getByText(/一起让花园唱起来/)).toBeVisible()
  await expect.poll(() => page.locator('.sg-cell.rhythm.filled').count()).toBeGreaterThanOrEqual(1)
})

When(
  'I plant Sound Garden melody {string} on beat {int}',
  async ({ page }, piece: string, beat: number) => {
    // Select the palette chip (剩余 count in its label), then tap the player's melody
    // cell on that beat.
    await page.getByRole('button', { name: new RegExp(`选择${piece}`) }).click()
    await page.getByRole('button', { name: `旋律 第${beat}拍` }).click()
  }
)

Then('the Sound Garden partner answers with rhythm roots', async ({ page, world }) => {
  // The scripted partner (debounced) lays synergizing rhythm roots under the new
  // melody flowers, so the rhythm lane grows past the single pre-seed root. Shared
  // navigation pauses Playwright's controlled clock at the deterministic seed;
  // explicitly advance the product debounce instead of waiting on wall time, which
  // cannot fire a timer on that paused clock.
  await world.advance(PARTNER_DEBOUNCE_MS)
  await expect.poll(() => page.locator('.sg-cell.rhythm.filled').count()).toBeGreaterThanOrEqual(2)
})

Then('the Sound Garden blooms', async ({ page }) => {
  // Reaching the harmony target blooms the garden (no-fail sandbox — bloom is the
  // settlement event).
  await expect(page.getByText(/花园绽放了/).first()).toBeVisible({ timeout: 15_000 })
})
