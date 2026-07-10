import { expect } from '@playwright/test'
import { Given, Then } from './fixtures'

Given('Shadow Chase optional network handoffs are unavailable', async ({ page }) => {
  await page.route('**/ai-intent/shadow-chase', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/api/shadow-chase/settlement', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  })
})

Then('the Shadow Chase opening rule is complete', async ({ page }) => {
  const copy = (await page.locator('body').innerText()).toLowerCase()
  expect(copy).toContain('first 5 seconds are a head start')
  expect(copy).toContain('three light cores')
  expect(copy).toContain('moon gate opens at 02:00')
  expect(copy).toContain('rescue a captured partner')
  expect(copy).toContain('leave together')
})

Then('the Shadow Chase board and essential controls are visible', async ({ page }) => {
  await expect(page.getByRole('application', { name: 'Dual Shadow Chase board' })).toBeVisible()
  await expect(page.getByText('Light cores')).toBeVisible()
  await expect(page.getByText('Rescue')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Swap positions' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move up' })).toBeVisible()
})

Then('Shadow Chase exposes no multiplayer affordance', async ({ page }) => {
  const copy = (await page.locator('body').innerText()).toLowerCase()
  for (const forbidden of ['room', 'matchmaking', 'pvp', 'voice room']) {
    expect(copy).not.toContain(forbidden)
  }
})

Then(
  'Shadow Chase survives the five-second opening window without input',
  async ({ page, world }) => {
    await world.advance(5_000)
    await expect(page.getByRole('application', { name: 'Dual Shadow Chase board' })).toBeVisible()
    await expect(page.locator('.hud-value').first()).not.toHaveText('00:00')
    await expect(page.locator('.hud').getByText(/Head start|Team safe/)).toBeVisible()
  }
)

Then('the Shadow Chase command {string} is active', async ({ page, world }, label: string) => {
  await world.advance(300)
  await expect(page.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
})

Then(
  'Shadow Chase phone controls are at least 44 pixels and do not cover the board',
  async ({ page }) => {
    const controls = page.locator('button:visible')
    for (let index = 0; index < (await controls.count()); index += 1) {
      const box = await controls.nth(index).boundingBox()
      expect(box, `button ${index} has a box`).not.toBeNull()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
    const board = await page
      .getByRole('application', { name: 'Dual Shadow Chase board' })
      .boundingBox()
    const commandPanel = await page.locator('.command-panel').boundingBox()
    expect(board).not.toBeNull()
    expect(commandPanel).not.toBeNull()
    expect(commandPanel!.y).toBeGreaterThanOrEqual(board!.y + board!.height)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
    expect(overflow).toBeLessThanOrEqual(0)
  }
)
