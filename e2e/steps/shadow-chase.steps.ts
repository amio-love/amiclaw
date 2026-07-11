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
  const ruleDisclosure = page.getByText('规则说明', { exact: true })
  await expect(ruleDisclosure).toBeVisible()
  await ruleDisclosure.click()
  const copy = await page.locator('body').innerText()
  expect(copy).toContain('战术准备结束后追兵立即行动')
  expect(copy).toContain('收集三枚光核')
  expect(copy).toContain('月门会立即开启')
  expect(copy).toContain('完成救援')
  expect(copy).toContain('抵达出口撤离')
  expect(copy).toContain(
    '追兵始终以略快速度走最短路：玩家自由时只追玩家，玩家被捕时转追伙伴，玩家获救后立即转回。碰到任意一方都会捕获；每枚光核提供一次换位，三枚集齐后月门立即开启。'
  )
  const pursuerRule = await page
    .getByRole('region', { name: '追兵规则' })
    .locator('p')
    .last()
    .innerText()
  await page.locator('html').evaluate((element, rule) => {
    ;(element as HTMLElement).dataset.shadowPursuerRule = rule
  }, pursuerRule)
})

Then('the Shadow Chase planning map is visible and frozen', async ({ page }) => {
  await expect(page.getByRole('application', { name: '双影追逃地图' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '制定策略' })).toBeVisible()
  await expect(page.getByText('地图冻结', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '立即出发' })).toBeVisible()
  await expect(page.getByRole('application', { name: '双影追逃地图' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  const setupRule = await page.locator('html').getAttribute('data-shadow-pursuer-rule')
  const ruleDisclosure = page.getByText('规则说明', { exact: true })
  await expect(ruleDisclosure).toBeVisible()
  await ruleDisclosure.click()
  const planningRule = await page.getByRole('region', { name: '追兵规则' }).locator('p').innerText()
  expect(planningRule).toBe(setupRule)
  const board = page.getByRole('application', { name: '双影追逃地图' })
  await expect(board).toHaveAccessibleDescription('追兵当前目标：你')
})

Then('the Shadow Chase board and essential controls are visible', async ({ page }) => {
  await expect(page.getByRole('application', { name: '双影追逃地图' })).toBeVisible()
  await expect(page.getByLabel('光核 0 / 3')).toBeVisible()
  await expect(page.getByText('双方安全', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '交换位置 · 0' })).toBeVisible()
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
  await world.advance(1100)
  await expect(page.getByRole('application', { name: '双影追逃地图' })).toBeVisible()
  await expect(page.locator('.hud').getByText('00:01')).toBeVisible()
  await expect(page.locator('.hud').getByText('双方安全')).toBeVisible()
  await expect(pursuer).toHaveAttribute('class', 'pursuer board-overlay')
  await expect(page.getByRole('application', { name: '双影追逃地图' })).toHaveAccessibleDescription(
    '追兵当前目标：你'
  )
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

Then('Shadow Chase shows a nonblocking pursuer target', async ({ page }) => {
  const indicator = page.locator('.pursuer-destination-indicator')
  await expect(indicator).toHaveCount(1)
  await expect(indicator).toBeVisible()
  await expect(page.getByRole('application', { name: '双影追逃地图' })).toHaveAccessibleDescription(
    /追兵当前目标：(你|AI 伙伴)/
  )
  await expect(indicator).toHaveCSS('pointer-events', 'none')
  await expect(indicator).toHaveAttribute('aria-hidden', 'true')
})
