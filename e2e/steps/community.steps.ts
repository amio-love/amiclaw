/** Community feed steps — the real, derived event stream + honest like gate. */
import { expect } from '@playwright/test'
import { Then, When } from './fixtures'

Then('the community feed shows real player activity', async ({ page, world }) => {
  const item = world.communityFeed.items[0]
  await expect(page.getByText(item.public_label).first()).toBeVisible()
  await expect(page.getByText('拆除了每日挑战。').first()).toBeVisible()
  // A live relative-time label rendered off the real event time (never the old
  // frozen「12 分钟前」fake). The seeded item is ~6 minutes before the pinned
  // clock, so it reads「6 分钟前」.
  await expect(page.getByText(/分钟前|小时前|刚刚/).first()).toBeVisible()
})

When('I try to like a community post', async ({ page }) => {
  await page.getByRole('button', { name: '点赞' }).first().click()
})

Then('I am prompted to log in before liking', async ({ page, world }) => {
  await expect(page.getByText(/登录后即可点赞/).first()).toBeVisible()
  // The honest gate is client-side: an anonymous like never fabricates a count
  // and never even fires the write — the prompt appears instead.
  expect(world.communityLikes).toHaveLength(0)
})
