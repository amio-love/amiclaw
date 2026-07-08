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

When('I enter a mode② daily run with the platform voice partner', async ({ page, world }) => {
  // Deterministic greeting-audio completion. The panel sets `isAiSpeaking` true
  // synchronously when the audio chunk arrives (→ 说话中) and clears it on the
  // buffer source's `onended` (→ 聆听中). In a real browser the WebAudio render
  // thread paints continuously, so `onended` fires for free after the buffer
  // duration; headless Chromium's audio thread is unreliable (the context often
  // starts suspended with no real sink and never advances), so `onended` may
  // never fire and the panel stays stuck at 说话中.
  //
  // Bridge the gap deterministically WITHOUT touching the product or faking the
  // settle: install a real-time timer that is NOT frozen by the page clock (the
  // scenario pins `page.clock` for the daily seed, which fakes setTimeout / rAF).
  // The stub greeting audio is `VOICE_AUDIO_SECONDS` long; after that much REAL
  // time, fire `onended` on the live buffer source so the panel settles on its
  // own code path — exactly what a real browser's audio clock would do.
  await page.addInitScript(
    `(() => {
      const proto = window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype;
      if (!proto || proto.__endPatched) return;
      proto.__endPatched = true;
      const origStart = proto.start;
      proto.start = function (...a) {
        let r; try { r = origStart.apply(this, a); } catch (e) {}
        // After the buffer's real duration, fire the source's own 'ended' so the
        // panel settles on its real code path — exactly what a live audio clock
        // would do. The delay rides a Worker timer (below), immune to the frozen
        // page clock.
        const dur = (this.buffer && this.buffer.duration ? this.buffer.duration : 3) * 1000 + 200;
        const src = this;
        window.__realDelay(dur).then(() => {
          try { src.dispatchEvent(new Event('ended')); } catch (e) {}
          if (typeof src.onended === 'function') { try { src.onended(new Event('ended')); } catch (e) {} }
        });
        return r;
      };
    })()`
  )
  // A clock-independent real-time delay: a dedicated Worker's setTimeout is not
  // touched by the main-thread page clock, so it elapses in true wall-clock time.
  await page.addInitScript(
    `(() => {
      const code = 'onmessage=function(e){setTimeout(function(){postMessage(e.data.id)}, e.data.ms)}';
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      const w = new Worker(url);
      let id = 0; const pending = {};
      w.onmessage = function (e) { const cb = pending[e.data]; if (cb) { delete pending[e.data]; cb(); } };
      window.__realDelay = function (ms) { return new Promise(function (res) { const k = ++id; pending[k] = res; w.postMessage({ id: k, ms: ms }); }); };
    })()`
  )
  await world.startPlatformVoiceDailyRun()
})

Then('the voice panel connects and the AI partner greets first', async ({ page, world }) => {
  const panel = voicePanel(page)
  await expect(panel).toBeVisible()
  // Hands-free + AI-first: the session connects (created -> ready) and the AI's
  // opening greeting streams with NO player input. Since #217 the companion's
  // spoken words render EXACTLY ONCE — in the top in-game subtitle strip
  // (伙伴字幕), fed by the panel's `onUtterance`, NOT re-rendered inside the panel
  // (which keeps only the connection / phase status so it never looks dead). So
  // the greeting reply is asserted on the subtitle strip, the sole surface it
  // renders on.
  await expect(page.getByRole('status', { name: '伙伴字幕' })).toHaveText(world.voice.reply)
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
  // Once the greeting audio finishes (the buffer source's `onended`, fired on real
  // wall-clock time by the harness Worker timer independent of the frozen page
  // clock — see the entry step), `isAiSpeaking` clears and the phase indicator
  // settles from 说话中 back to 聆听中. Generous timeout covering the ~3s playback.
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
