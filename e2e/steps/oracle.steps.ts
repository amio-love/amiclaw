/** Yijing Oracle steps — the /oracle/ hash-routed SPA (honest demo ritual). */
import { expect } from '@playwright/test'
import { Then, When } from './fixtures'

/** Strings the F24/F25 honesty rework removed from the oracle flow. None of
 *  them may render anywhere on any oracle screen while the flow stays a pure
 *  frontend ritual (zero model / voice API calls). 「真实卦签」 additionally
 *  guards the demo cast from being re-declared as a real sign (fix-round F1). */
const BANNED_CLAIMS = [
  'AI',
  'Claude',
  '语音',
  '读心',
  '正在说话',
  '听你说',
  '随时打断',
  '真实卦签',
] as const

Then('the oracle route is {string}', async ({ page }, route: string) => {
  await expect.poll(() => new URL(page.url()).hash).toBe(`#${route}`)
})

Then('the oracle page makes no AI, voice, or mind-reading claim', async ({ page }) => {
  const text = (await page.locator('body').textContent()) ?? ''
  for (const banned of BANNED_CLAIMS) {
    expect(text, `oracle page must not claim "${banned}"`).not.toContain(banned)
  }
})

When('I pick 2 projection images', async ({ page }) => {
  // ProjArt tiles are unnamed icon buttons inside the projection grid; the
  // named controls on the page (返回 / 清空 / 确认) all carry accessible names,
  // so the tiles are addressed by their CSS-module class.
  const tiles = page.locator('button[class*="tile"]')
  await expect(tiles).toHaveCount(6)
  await tiles.nth(0).click()
  await tiles.nth(1).click()
  await expect(page.getByText('已选 2 / 2')).toBeVisible()
})

When('I complete the six coin throws', async ({ page, world }) => {
  // Each throw runs a 850ms coin-flip timer before the yao value lands; the
  // harness clock is paused (fixtures pin it for run-seed determinism), so
  // every tap is followed by an explicit clock advance to fire that timer.
  for (let throwIdx = 0; throwIdx < 6; throwIdx++) {
    const label = throwIdx === 0 ? '投币 →' : `投第 ${throwIdx + 1} 爻 →`
    await page.getByRole('button', { name: label }).click()
    await world.advance(900)
  }
  await expect(page.getByRole('button', { name: '继续 · 读卦辞 →' })).toBeVisible()
})
