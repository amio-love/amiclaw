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
  const copy = await page.locator('body').innerText()
  expect(copy).toContain('战术准备结束后追兵立即行动')
  expect(copy).toContain('收集三枚光核')
  expect(copy).toContain('02:00 开启')
  expect(copy).toContain('完成救援')
  expect(copy).toContain('一起撤离')
})

Then('the Shadow Chase planning map is visible and frozen', async ({ page }) => {
  await expect(page.getByRole('application', { name: '双影追逃地图' })).toBeVisible()
  await expect(page.getByText('战术准备')).toBeVisible()
  await expect(page.getByRole('button', { name: '立即出发' })).toBeVisible()
  await expect(page.getByRole('application', { name: '双影追逃地图' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
})

Then('the Shadow Chase board and essential controls are visible', async ({ page }) => {
  await expect(page.getByRole('application', { name: '双影追逃地图' })).toBeVisible()
  await expect(page.getByText('光核', { exact: true })).toBeVisible()
  await expect(page.getByText('救援', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '交换位置' })).toBeVisible()
  await expect(page.getByRole('button', { name: '向上移动' })).toBeVisible()
})

Then('Shadow Chase exposes no multiplayer affordance', async ({ page }) => {
  const copy = (await page.locator('body').innerText()).toLowerCase()
  for (const forbidden of ['room', 'matchmaking', 'pvp', 'voice room']) {
    expect(copy).not.toContain(forbidden)
  }
})

Then('Shadow Chase pursuit is active when the chase starts', async ({ page, world }) => {
  const pursuer = page.getByLabel('追兵')
  const startingTransform = await pursuer.getAttribute('transform')
  await world.advance(600)
  await expect(page.getByRole('application', { name: '双影追逃地图' })).toBeVisible()
  await expect(page.locator('.hud').getByText('双方安全')).toBeVisible()
  await expect(pursuer).toHaveAttribute('class', 'pursuer board-overlay')
  expect(await pursuer.getAttribute('transform')).not.toBe(startingTransform)
})

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
    const board = await page.getByRole('application', { name: '双影追逃地图' }).boundingBox()
    const commandPanel = await page.locator('.strategy-panel').boundingBox()
    expect(board).not.toBeNull()
    expect(commandPanel).not.toBeNull()
    expect(commandPanel!.y).toBeGreaterThanOrEqual(board!.y + board!.height)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
    expect(overflow).toBeLessThanOrEqual(0)
  }
)

Then('Shadow Chase accepts a path target through an overlay', async ({ page, world }) => {
  const core = await page.locator('.core').first().boundingBox()
  expect(core).not.toBeNull()
  await page.mouse.click(core!.x + core!.width / 2, core!.y + core!.height / 2)
  await world.advance(300)
  await expect(page.locator('.path-target')).toBeVisible()
})
