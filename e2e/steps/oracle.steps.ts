/** Yijing Oracle steps — the /oracle/ hash-routed SPA (honest coin-cast ritual). */
import { expect } from '@playwright/test'
import { Given, Then, When } from './fixtures'

/** Strings the F24/F25 honesty rework removed from the oracle flow. None of
 *  them may render anywhere on any oracle screen while the flow stays a pure
 *  frontend ritual (zero model / voice API calls). 「真实卦签」 guards the old
 *  overclaim; the demo-era interim markers (卦例演示 / 固定卦例 / 样例) joined
 *  the ban when real three-coin randomness + the full 64-hexagram manual
 *  landed — the cast is real now, so demo labeling would itself be a lie. */
const BANNED_CLAIMS = [
  'AI',
  'Claude',
  '语音',
  '读心',
  '正在说话',
  '听你说',
  '随时打断',
  '真实卦签',
  '卦例演示',
  '固定卦例',
  '样例',
] as const

Given('the oracle cast is rigged to land 同人之九三', async ({ page }) => {
  // PageCasting draws ONE byte per throw (crypto.getRandomValues on a
  // Uint8Array(1); low 3 bits = the three coins, heads count = value - 6).
  // Rig the six casting bytes [1, 3, 7, 1, 1, 1] → yao values [7,8,9,7,7,7]
  // bottom-up = 同人 #13 with 九三 changing → 无妄 #25, the classic journey
  // cast. Queue-then-passthrough keeps every other getRandomValues caller on
  // real randomness. Mirrors the harness's controlled-clock pattern: rig the
  // nondeterminism source, keep the product code untouched.
  await page.addInitScript(() => {
    const queue = [1, 3, 7, 1, 1, 1]
    const original = crypto.getRandomValues.bind(crypto)
    crypto.getRandomValues = function riggedGetRandomValues<T extends ArrayBufferView | null>(
      array: T
    ): T {
      if (array instanceof Uint8Array && array.length === 1 && queue.length > 0) {
        array[0] = queue.shift() ?? 0
        return array
      }
      return original(array)
    }
  })
})

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
