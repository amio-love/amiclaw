/**
 * mode② in-game voice-panel steps. Drives the VoicePanel through one
 * deterministic push-to-talk turn against the stubbed `/ai-ws/*` socket (see
 * e2e/steps/fixtures.ts `routeWebSocket`) and the Chromium fake mic device (see
 * playwright.config.ts launch flags). Asserts the panel's UI states only — never
 * real audio or provider output.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { When, Then } from './fixtures'

/** The voice panel — `<section aria-label="AI 语音伙伴">` renders as a region. */
function voicePanel(page: Page): Locator {
  return page.getByRole('region', { name: 'AI 语音伙伴' })
}

When('I enter a mode② daily run with the platform voice partner', async ({ world }) => {
  await world.startPlatformVoiceDailyRun()
})

Then('the voice panel shows the AI partner is connected', async ({ page }) => {
  const panel = voicePanel(page)
  await expect(panel).toBeVisible()
  // `created` -> ready: the status reads 已连接 and the reply log invites a turn.
  await expect(panel.getByText('已连接')).toBeVisible()
  await expect(panel.getByText('按住下面的按钮，对 AI 说话')).toBeVisible()
  // The push-to-talk control is enabled only once the session is ready.
  await expect(panel.getByRole('button')).toBeEnabled()
})

When('I push and hold the talk button, then release', async ({ page }) => {
  const panel = voicePanel(page)
  const talkBtn = panel.getByRole('button')
  // Keyboard hold-to-talk (Space) — a trusted key event, no pointer-capture
  // dance. Keydown starts the turn (fake-mic getUserMedia resolves), so the
  // status flips to 通话中; hold until that is observed, then release to send
  // the turn to the stubbed bridge.
  await talkBtn.focus()
  await page.keyboard.down('Space')
  await expect(panel.getByText('通话中')).toBeVisible()
  await page.keyboard.up('Space')
})

Then("the panel renders the AI's stubbed voice reply", async ({ page, world }) => {
  await expect(voicePanel(page).getByText(world.voice.reply)).toBeVisible()
})

Then(
  'the panel shows the "AI is speaking" indicator while the reply audio plays',
  async ({ page }) => {
    await expect(voicePanel(page).getByText('AI 正在回应')).toBeVisible()
  }
)

When('I exit the run', async ({ page }) => {
  // `退出` confirms via window.confirm before navigating to the platform home;
  // accept it so the run resets and the voice panel tears down.
  page.once('dialog', (dialog) => {
    void dialog.accept()
  })
  await page.getByRole('button', { name: '退出当前关卡' }).click()
})

Then('the voice session ends and the panel is gone', async ({ page }) => {
  await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 12_000 })
  await expect(voicePanel(page)).toHaveCount(0)
})
