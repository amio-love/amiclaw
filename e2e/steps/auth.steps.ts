/** mode② magic-link auth steps — login form, signed-out /me guide, signed-in
    /me profile. Auth state is driven by the GET /api/auth/session route mock
    (world.signIn) and the magic-link request capture, both wired in fixtures.ts. */
import { expect } from '@playwright/test'
import { Given, When, Then } from './fixtures'

const TEST_EMAIL = 'nova@amio.fans'

// --- /login form -------------------------------------------------------------

Then('I see the login email form and the Google sign-in button', async ({ page }) => {
  await expect(page.getByLabel('邮箱')).toBeVisible()
  await expect(page.getByRole('button', { name: '发送登录链接' })).toBeVisible()
  // The Google option is a real navigational link, live now that the start
  // endpoint exists.
  await expect(page.getByRole('link', { name: /Google/ })).toBeVisible()
})

Then('I see the honest framing and the direct-play escape', async ({ page }) => {
  // The page states the value of an account (the end-state product value) and
  // that playing with your own AI needs no account.
  await expect(page.getByText(/玩游戏不需要登录/)).toBeVisible()
  // States the account's CURRENT value (companion + community + cross-device),
  // not the old aspirational「你将拥有…社交主场」 (B6 copy-honesty sweep).
  await expect(page.getByText(/登录后，你会有专属于你的 AI 伙伴/)).toBeVisible()
  // The direct-play escape into free anonymous play. It navigates via
  // window.location.assign('/bombsquad/'); presence + label is asserted here,
  // the navigation target is covered by the LoginPage unit test (no click, so
  // the scenario can go on to submit the email form without leaving the page).
  await expect(page.getByRole('button', { name: '带自己的 AI 直接开始玩' })).toBeVisible()
})

// RegExp-registered: the literal step text contains `/api/auth/google/start`,
// and a bare `/` is a Cucumber-expression alternation separator (same dodge as
// the `I am signed in on /me` step above).
Then(/^the Google sign-in button links to \/api\/auth\/google\/start$/, async ({ page }) => {
  // Assert the wiring only: the server-side OAuth round-trip (state-check,
  // token exchange, callback session) has no Workers runtime in the harness and
  // the Google consent screen is cross-origin, so it is covered by the backend
  // integration tests (auth-google.test.ts), not faked here.
  const href = await page.getByRole('link', { name: /Google/ }).getAttribute('href')
  expect(href).toContain('/api/auth/google/start')
})

When('I enter my email and submit the login form', async ({ page }) => {
  await page.getByLabel('邮箱').fill(TEST_EMAIL)
  await page.getByRole('button', { name: '发送登录链接' }).click()
})

Then('I see the unified login confirmation', async ({ page }) => {
  await expect(page.getByText('如果该邮箱可用，你会收到一封登录邮件。')).toBeVisible()
})

Then('a magic-link request was sent for my email', async ({ world }) => {
  await expect.poll(() => world.magicLinkRequests.length).toBeGreaterThan(0)
  expect(world.magicLinkRequests.at(-1)).toMatchObject({ email: TEST_EMAIL })
})

// --- signed-out /me local profile -------------------------------------------

Then('I see the account login guide and no fake profile', async ({ page }) => {
  // Scope to the routed page content (<main>): the TopNav shell also renders a
  // 登录 / 注册 auth entry (substring-matched by name '登录'), so page-wide
  // role/text queries would be ambiguous.
  const main = page.getByRole('main')
  await expect(main.getByText('你的星轨。')).toBeVisible()
  await expect(main.getByText('保存到账号', { exact: true })).toBeVisible()
  await expect(
    main.getByText('登录后可以把这台设备上的 BombSquad 和卦签记录保存到账号。')
  ).toBeVisible()
  await expect(main.getByText('今日')).toBeVisible()
  await expect(main.getByText('未打卡')).toBeVisible()
  await expect(main.getByRole('link', { name: '登录' })).toBeVisible()
  // No retired mock-profile content for anyone now.
  await expect(main.getByText('林星海')).toHaveCount(0)
  await expect(main.getByText('最近 5 局')).toHaveCount(0)
  await expect(main.getByText('登录后查看你的星轨')).toHaveCount(0)
})

When('I click the login guide CTA', async ({ page }) => {
  await page.getByRole('main').getByRole('link', { name: '登录' }).click()
})

// --- signed-in /me profile ---------------------------------------------------

// RegExp-registered: the literal step text contains `/me`, and a bare `/` is a
// Cucumber-expression alternation separator (same dodge as the `I open /` step).
Given(/^I am signed in on \/me$/, async ({ world }) => {
  // signIn() must precede the navigation so the first session read returns
  // authenticated. The email local-part `nova` is the derived display name.
  world.signIn({ user_id: 'e2e-user', email: TEST_EMAIL })
  await world.openPath('/me')
})

Then('I see my real identity from the session', async ({ page }) => {
  // Scope to the routed page content; the display name is the email local-part
  // and the email itself is shown on the profile card.
  const main = page.getByRole('main')
  await expect(main.getByText('nova').first()).toBeVisible()
  await expect(main.getByText(TEST_EMAIL)).toBeVisible()
})

Then('I see the honest empty stats state with a play CTA', async ({ page }) => {
  // No fabricated numbers, no「即将推出」placeholder — an honest empty state.
  const main = page.getByRole('main')
  await expect(main.getByText('账号记录')).toBeVisible()
  await expect(main.getByText('未打卡')).toBeVisible()
  await expect(main.getByText('还没有记录').first()).toBeVisible()
  await expect(main.getByText('无记录').first()).toBeVisible()
  await expect(main.getByRole('link', { name: '开始玩' })).toBeVisible()
})

Then('the account login guide is not shown', async ({ page }) => {
  const main = page.getByRole('main')
  await expect(main.getByText('登录后查看你的星轨')).toHaveCount(0)
  await expect(main.getByText('本设备的星轨。')).toHaveCount(0)
})
