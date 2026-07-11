import { test, expect, type Page } from '@playwright/test'

/**
 * End-to-end WIN + LOSE runs of Botanical Garden (design §6), driving the REAL
 * app + REAL engine over the bg-demo-001 tutorial. Time is CONTROLLED: the
 * wall-clock decay loop is off (`?e2e=1`) and the test drives decay through the
 * `window.__botanicalAdvance(dtMs)` seam — no real-time waits, fully repeatable.
 */

const pot = (page: Page, name: RegExp) => page.getByRole('button', { name })

/** Drive simulated time deterministically through the controlled-clock seam. */
async function advance(page: Page, dtMs: number): Promise<void> {
  await page.evaluate((ms) => {
    ;(window as unknown as { __botanicalAdvance: (n: number) => void }).__botanicalAdvance(ms)
  }, dtMs)
}

test.describe('Botanical Garden — WIN', () => {
  test('tutorial care path reaches 养护成功; Play Again resets to a fresh session', async ({
    page,
  }) => {
    await page.goto('/botanical/?e2e=1')
    await expect(page.getByRole('timer')).toHaveText('00:00')

    // Heal the wilting fern (water), then heal + grow the orchid to flowering.
    await pot(page, /蕨类/).click()
    await page.getByRole('button', { name: '浇水' }).click()
    await expect(pot(page, /蕨类/)).toHaveAccessibleName(/稳定/)

    await pot(page, /兰花/).click()
    await page.getByRole('button', { name: '遮光' }).click() // → partial_shade + heal
    await page.getByRole('button', { name: '施肥' }).click() // seedling → juvenile
    await page.getByRole('button', { name: '换盆' }).click() // juvenile → mature
    await page.getByRole('button', { name: '催花' }).click() // mature → flowering → WIN

    // Assertion 1: results overlay with 用时 + 操作数 present.
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('养护成功')
    await expect(dialog).toContainText('用时')
    await expect(dialog).toContainText('操作数')

    // Assertion 2: Play Again resets to a fresh session.
    await dialog.getByRole('button', { name: '再玩一次' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('timer')).toHaveText('00:00')
    await expect(pot(page, /蕨类/)).toHaveAccessibleName(/枯萎/) // back to the wilting start
  })
})

test.describe('Botanical Garden — LOSE', () => {
  test('decay warning shows before a tick; neglect to death reaches 养护失败', async ({ page }) => {
    await page.goto('/botanical/?e2e=1')
    await page.waitForFunction(() => '__botanicalAdvance' in window)

    // Assertion 3: the decay ring WARNING is visible BEFORE any tick. The orchid
    // (offset 40000, interval 60000) ticks at 20000ms; its 8000ms warning window
    // opens at 12000ms, so at 15000ms it warns but has not yet ticked.
    await advance(page, 15000)
    await expect(pot(page, /兰花/)).toHaveAttribute('data-decay', 'warning')
    await expect(page.getByRole('dialog')).toHaveCount(0) // no tick / no end yet

    // Drive neglect to death: each advance fires one tick per plant.
    await advance(page, 60000) // wilting → critical (no death yet)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await advance(page, 60000) // critical → dead → LOSE

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('养护失败')
    await expect(dialog).toContainText('用时')
  })
})
