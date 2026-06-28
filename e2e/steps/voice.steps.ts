/**
 * mode② in-game voice-panel steps. Drives the hands-free VoicePanel through its
 * deterministic opening greeting against the stubbed `/ai-ws/*` socket (see
 * e2e/steps/fixtures.ts `routeWebSocket`) and the Chromium fake mic fed a silent
 * capture file (see playwright.config.ts launch flags). There is no push-to-talk:
 * the AI greets first on session-create, and the silent mic never crosses the
 * client VAD threshold, so no player turn or barge-in fires. Asserts the panel's
 * UI states only — never real audio or provider output, never the VAD-triggered
 * player turn.
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

Then('the voice panel connects and the AI partner greets first', async ({ page, world }) => {
  const panel = voicePanel(page)
  await expect(panel).toBeVisible()
  // Hands-free + AI-first: the session connects (created -> ready) and the AI's
  // opening greeting streams with NO player input — its stubbed text reply
  // rendering in the panel's reply log is the proof of both.
  await expect(panel.getByText(world.voice.reply)).toBeVisible()
})

Then('the panel shows the AI is speaking while the greeting audio plays', async ({ page }) => {
  const panel = voicePanel(page)
  // While the greeting's TTS audio plays, the live 3-state indicator reads 说话中
  // and the dedicated "speaking" cue (role=status, accessible name AI 正在说话)
  // shows. `isAiSpeaking` is set synchronously when the audio chunk arrives, so
  // this is observable even though the PCM is silent.
  await expect(panel.getByText('说话中')).toBeVisible()
  await expect(panel.getByRole('status', { name: 'AI 正在说话' })).toBeVisible()
})

Then('the panel settles to the listening state when the greeting ends', async ({ page }) => {
  // Once the greeting audio finishes (its AudioBufferSource `onended`, on the real
  // audio-thread clock — independent of the frozen page clock), `isAiSpeaking`
  // clears and the indicator settles to 聆听中. Give it a generous wait covering
  // the few-second playback.
  await expect(voicePanel(page).getByText('聆听中')).toBeVisible({ timeout: 12_000 })
})

When('I exit the run', async ({ page }) => {
  // `退出当前关卡` confirms via window.confirm before navigating to the platform
  // home; accept it so the run resets and the voice panel tears down.
  page.once('dialog', (dialog) => {
    void dialog.accept()
  })
  await page.getByRole('button', { name: '退出当前关卡' }).click()
})

Then('the voice session ends and the panel is gone', async ({ page }) => {
  await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 12_000 })
  await expect(voicePanel(page)).toHaveCount(0)
})
