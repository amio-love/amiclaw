/** Radio Cipher listener-run journey steps. The /radio-cipher/ SPA plays fully
 * client-side (no network), so these steps drive the real content + creation
 * engine directly: the win is engine-driven decryption, and the codebook is
 * asserted to carry no listener-side plaintext answer. */
import { expect } from '@playwright/test'
import { Then, When } from './fixtures'

Then('the Radio Cipher onboarding explains the two roles', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: '怎么玩' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('你是监听员')
  await expect(dialog).toContainText('译码员')
})

When('I dismiss the Radio Cipher onboarding', async ({ page }) => {
  await page.getByRole('button', { name: '开始收听' }).click()
  await expect(page.getByRole('dialog', { name: '怎么玩' })).toBeHidden()
})

When(
  'I decrypt Radio Cipher segment {string} as {string}',
  async ({ page }, label: string, answer: string) => {
    // Each SegmentCard is a <section aria-label={label}> — role region — so the
    // answer input and 发报确认 button are scoped to the right segment even
    // though both segments share the same button label.
    const card = page.getByRole('region', { name: label })
    await card.getByLabel(`${label} 解密答案`).fill(answer)
    await card.getByRole('button', { name: '发报确认' }).click()
    await expect(card.getByText('已解密 · 电文确认')).toBeVisible()
  }
)

Then('the Radio Cipher run is won', async ({ page }) => {
  const banner = page.getByRole('status')
  await expect(banner).toContainText('解密完成 · 胜利')
  await expect(banner).toContainText('新手训练电台')
})

When('I open the Radio Cipher codebook', async ({ page }) => {
  // The codebook is the same SPA under the #/codebook hash route. A same-page
  // fragment navigation fires hashchange, which App listens to and re-renders.
  await page.goto('/radio-cipher/#/codebook')
})

Then(
  'the Radio Cipher codebook teaches the cipher without revealing any answer',
  async ({ page }) => {
    await expect(page.getByRole('heading', { name: '译码员密码本' })).toBeVisible()
    const body = page.locator('body')
    await expect(body).toContainText('韵母环')
    await expect(body).toContainText('协议')
    // The listener-side plaintext answers must never reach the shareable
    // codebook — the information partition is enforced by construction.
    await expect(body).not.toContainText('猴子')
    await expect(body).not.toContainText('紫色')
  }
)
