/** Result-page endgame-survey steps — the once-per-device fold-in survey. */
import { expect } from '@playwright/test'
import { Given, When, Then } from './fixtures'

const SURVEY_DELAY_MS = 4400 // clears the longest (practice, 4200ms) celebration-to-entry delay

/** Answer Q1/Q2/Q3 — the three required survey questions inside an open modal. */
async function answerRequiredSurvey(dialog: import('@playwright/test').Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Claude', exact: true }).click()
  await dialog.getByRole('button', { name: '好玩程度 4 分', exact: true }).click()
  await dialog.getByRole('button', { name: '刚好', exact: true }).click()
}

// --- Reaching the result page on a survey-fresh device -----------------------

Given(
  'I have finished a {string} run on a survey-fresh device and the result page is open',
  async ({ world }, mode: string) => {
    await world.openPath('/')
    if (mode === 'daily') {
      await world.driveDailyToResult()
    } else {
      await world.drivePracticeToResult()
    }
  }
)

// --- Fold-in survey entry (audit U13) ----------------------------------------

When('the endgame survey entry folds in and I open it', async ({ page, world }) => {
  // The settlement owns the first beat; the survey is never an auto-opening
  // modal. Advance the controlled clock past the fold-in delay so the calm
  //「聊聊这一局」entry appears, then tap it to open the survey modal.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const entry = page.getByRole('button', { name: /聊聊这一局/ })
  if ((await entry.count()) === 0) {
    await world.advance(SURVEY_DELAY_MS)
  }
  // Nothing stacked over the celebration before the tap.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(entry).toBeVisible()

  await entry.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveCount(1)
  await expect(dialog.getByText('你这局用的是哪个 AI 工具？')).toBeVisible()
  await expect(dialog.getByText('难度感受')).toBeVisible()
})

// --- Survey interactions -----------------------------------------------------

When('I answer and submit the survey', async ({ page }) => {
  const dialog = page.getByRole('dialog')
  await answerRequiredSurvey(dialog)
  await dialog.getByRole('button', { name: '提交', exact: true }).click()
})

When('I skip the survey', async ({ page }) => {
  // The survey's dismiss control is 跳过; the shared Modal's × is 关闭, so this
  // resolves uniquely.
  await page.getByRole('dialog').getByRole('button', { name: '跳过', exact: true }).click()
})

Then('the survey dialog closes', async ({ page }) => {
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

// --- Emitted-event assertions ------------------------------------------------

Then('a {string} event records my survey answers', async ({ world }, eventName: string) => {
  // `survey_submit` is fire-and-forget — poll the captured /api/events POSTs.
  await expect
    .poll(() => world.events.filter((event) => event.event === eventName).length, {
      message: `expected a ${eventName} event POST to be captured`,
    })
    .toBeGreaterThan(0)
  const event = world.events.find((entry) => entry.event === eventName) as {
    data?: Record<string, unknown>
  }
  expect(event.data).toMatchObject({ ai_tool: 'claude', fun: 4, difficulty: 'just-right' })
})

Then('no {string} event is recorded', async ({ world }, eventName: string) => {
  // The skip path never calls logEvent('survey_submit') — no POST is ever made.
  expect(world.events.some((event) => event.event === eventName)).toBe(false)
})

// --- Once-per-device gate ----------------------------------------------------

When('I revisit the result page', async ({ world }) => {
  // Reload the result page in place. The finished-game state is mirrored into
  // sessionStorage so ResultPage re-hydrates and re-runs its survey check; the
  // survey-answered flag written by the first interaction persists, so the entry
  // must not fold in again. (A full second run is not viable — the controlled
  // clock cannot rewind to re-pin the run seed.)
  await world.page.reload()
})

Then('the endgame survey entry does not fold in', async ({ page }) => {
  // The result heading proves ResultPage re-mounted from the persisted state;
  // advance past the fold-in delay before asserting the entry never appears.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.clock.runFor(SURVEY_DELAY_MS)
  await expect(page.getByRole('button', { name: /聊聊这一局/ })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
