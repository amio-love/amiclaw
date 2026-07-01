/** mode② companion onboarding steps — the /me/companion setup flow.
    Auth + the /api/companion* control plane are route-mocked in fixtures.ts
    (world.signIn + world.companion), so this journey runs against the static
    build with no Workers runtime, exactly like the magic-link auth journey. */
import { expect } from '@playwright/test'
import { Given, When, Then } from './fixtures'

const TEST_EMAIL = 'nova@amio.fans'

Given('I am a signed-in player without a companion', async ({ world }) => {
  // signIn() must precede navigation so the first session read is authenticated;
  // companion stays null so the read 404s and the onboarding form shows.
  world.signIn({ user_id: 'e2e-user', email: TEST_EMAIL })
  world.companion = null
})

When('I open the companion onboarding page', async ({ world }) => {
  await world.openPath('/me/companion')
})

When('I name my companion {string} and pick a voice', async ({ page }, name: string) => {
  const main = page.getByRole('main')
  await main.getByLabel('名字').fill(name)
  // Pick the first voice option (represented by name + description, no audio).
  await main.getByRole('radio').first().click()
  await main.getByRole('button', { name: '认识你的伙伴' }).click()
})

Then('I see my companion {string}', async ({ page }, name: string) => {
  // The identity panel reads "你的伙伴 X" after the setup is read back.
  await expect(page.getByRole('main').getByText(name).first()).toBeVisible()
})

Then('revisiting onboarding shows my companion, not the setup form', async ({ page, world }) => {
  await world.openPath('/me/companion')
  const main = page.getByRole('main')
  // The identity is shown; the name input (the setup form) is gone — one
  // companion per account, no second-setup path.
  await expect(main.getByText('小光').first()).toBeVisible()
  await expect(main.getByLabel('名字')).toHaveCount(0)
})
