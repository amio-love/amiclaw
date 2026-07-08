/** Result-page endgame-survey steps — the once-per-device PostGameModal. */
import { expect } from '@playwright/test'
import { Given, When, Then } from './fixtures'

/** Stable test player metadata for the daily leaderboard gate — mirrors result.steps. */
const E2E_NICKNAME = 'E2ERunner'
const E2E_AI_ASSISTANT_LABEL = 'Claude'
const SURVEY_DELAY_MS = 4400 // clears the longest (practice, 4200ms) celebration-to-survey delay

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

Given('any required leaderboard gate is completed before the survey', async ({ page, world }) => {
  if (world.runMode !== 'daily') return

  // The gate no longer auto-opens (rank-reveal-first) — open it from the
  // rank card's CTA, then fill and confirm. The survey delay only starts
  // once the rank outcome has settled, i.e. after this submission lands.
  await page.getByRole('button', { name: '填写并上榜' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveCount(1)
  await dialog.getByRole('textbox', { name: '昵称' }).fill(E2E_NICKNAME)
  await dialog.getByRole('button', { name: E2E_AI_ASSISTANT_LABEL, exact: true }).click()
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => world.leaderboard.submissions.length).toBeGreaterThan(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

Then(
  'the post-game modal opens as a single dialog showing the survey questions',
  async ({ page, world }) => {
    // The result needs breathing room before the survey opens.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const dialog = page.getByRole('dialog')
    if ((await dialog.count()) === 0) {
      await world.advance(SURVEY_DELAY_MS)
    }

    // Exactly one dialog — daily leaderboard and survey gates never stack.
    await expect(dialog).toHaveCount(1)
    await expect(dialog.getByText('你这局用的是哪个 AI 工具？')).toBeVisible()
    await expect(dialog.getByText('难度感受')).toBeVisible()
  }
)

// --- Survey interactions -----------------------------------------------------

When('I answer and submit the survey', async ({ page }) => {
  const dialog = page.getByRole('dialog')
  await answerRequiredSurvey(dialog)
  await dialog.getByRole('button', { name: '提交', exact: true }).click()
})

When('I skip the survey', async ({ page }) => {
  // `exact` is load-bearing: the close button's aria-label is 「跳过问卷」, so a
  // non-exact 「跳过」 match would resolve two controls.
  await page.getByRole('dialog').getByRole('button', { name: '跳过', exact: true }).click()
})

When('I submit a nickname with the survey', async ({ page }) => {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: '昵称' }).fill(E2E_NICKNAME)
  await answerRequiredSurvey(dialog)
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
})

Then('the post-game modal closes', async ({ page }) => {
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
  // sessionStorage so ResultPage re-hydrates and re-runs its mount-time survey
  // check; the survey-answered flag written by the first interaction persists,
  // so the modal must not reappear. (A full second run is not viable — the
  // controlled clock cannot rewind to re-pin the run seed.)
  await world.page.reload()
})

Then('no post-game survey modal appears', async ({ page }) => {
  // The result heading proves ResultPage re-mounted from the persisted state;
  // advance past the deferred survey delay before asserting absence.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.clock.runFor(SURVEY_DELAY_MS)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
