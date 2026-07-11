/** Daily-leaderboard date-navigation steps — the compact date switcher on the
 *  BombSquad daily time board (platform /leaderboard route). The harness clock
 *  is pinned to the answers seed, so "today" inside the page is the seed's
 *  product day and "yesterday" is exactly one day earlier. */
import { expect } from '@playwright/test'
import { Given, Then, When } from './fixtures'

const DAY_MS = 86_400_000

Given("today's daily board has entries and yesterday's board has one entry", async ({ world }) => {
  const today = new Date(world.seedT).toISOString().slice(0, 10)
  const yesterday = new Date(world.seedT - DAY_MS).toISOString().slice(0, 10)
  world.leaderboard.boardsByDate = {
    [today]: world.leaderboard.getResponse.entries,
    [yesterday]: [{ rank: 1, nickname: '昨日冠军', time_ms: 87_000, attempt_number: 1 }],
  }
})

When('I open the leaderboard page', async ({ page }) => {
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '排行榜', exact: true })
    .click()
  await expect(page.getByText('BombSquad 每日时间榜')).toBeVisible()
})

When('I switch the daily board to 前一天', async ({ page }) => {
  await page.getByRole('button', { name: '前一天' }).click()
})

When('I switch the daily board to 后一天', async ({ page }) => {
  await page.getByRole('button', { name: '后一天' }).click()
})

Then("the daily board shows today's entries", async ({ page, world }) => {
  // The default fixture board's #1 row.
  await expect(page.getByText(world.leaderboard.getResponse.entries[0].nickname)).toBeVisible()
  await expect(page.getByText('昨日冠军')).toHaveCount(0)
})

Then("the daily board shows yesterday's entry", async ({ page }) => {
  await expect(page.getByText('昨日冠军')).toBeVisible()
})

Then('the daily board states its retention boundary honestly', async ({ page }) => {
  // The switcher window equals the KV retention (today + yesterday); the
  // boundary — and where older personal records live — is stated honestly, now
  // relocated behind the ⓘ next to the date (rc §3 progressive disclosure). Open
  // the disclosure, then assert the honest content is reachable and verbatim.
  await page.getByRole('button', { name: '日榜刷新与保留说明' }).click()
  await expect(page.getByText(/每日榜只保留今天和昨天，更早的日榜未保存/)).toBeVisible()
})

Then('the 后一天 control is disabled', async ({ page }) => {
  await expect(page.getByRole('button', { name: '后一天' })).toBeDisabled()
})

Then('the 前一天 control is disabled', async ({ page }) => {
  await expect(page.getByRole('button', { name: '前一天' })).toBeDisabled()
})

Then('the daily board date label reads {word}', async ({ page }, label: string) => {
  await expect(page.getByText(label, { exact: true })).toBeVisible()
})
