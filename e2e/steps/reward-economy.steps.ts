import { expect } from '@playwright/test'
import { Given, When, Then } from './fixtures'

// Sign in BEFORE the first navigation (mirrors the companion-dock background):
// the seeded starburst balance is the World default, so this only marks the
// session authenticated so the assets route returns 200.
Given('I am a signed-in player with a starburst balance', async ({ world }) => {
  world.signIn({ user_id: 'u_reward', email: 'nova@amio.fans' })
})

Then('the header shows my starburst balance of {int}', async ({ page }, balance: number) => {
  await expect(page.getByRole('button', { name: new RegExp(`星芒余额 ${balance}`) })).toBeVisible()
})

When('I open the starburst ledger', async ({ page }) => {
  await page.getByRole('button', { name: /星芒余额/ }).click()
})

Then('the ledger lists my 过关奖励 and 见面礼 entries', async ({ page }) => {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('过关奖励')).toBeVisible()
  await expect(dialog.getByText('见面礼')).toBeVisible()
})
