/**
 * Regression step for the anonymous homepage hero CTA (re-audit F1).
 *
 * On a phone, the decorative planet stage's orbiting ring overflowed up over the
 * primary「开始玩」CTA and swallowed a CENTER tap — only the button's left/right
 * edges routed. Playwright's `.click()` targets the element center AND refuses to
 * click through an intercepting overlay, so a plain center click is the faithful
 * guard: pre-fix it fails with "…planetRing2… intercepts pointer events", post-fix
 * it routes to BombSquad.
 */
import { Given, When } from './fixtures'

When('I tap the center of the「开始玩」hero CTA', async ({ page }) => {
  const cta = page.getByRole('button', { name: '开始玩 →' })
  await cta.waitFor({ state: 'visible', timeout: 8000 })
  await cta.click()
})

// Re-exported convenience alias so the scenario reads naturally after a viewport
// change; the actual anon gate lives in homepage.steps.ts.
Given('the anonymous homepage is shown', async ({ page }) => {
  await page.getByRole('button', { name: '开始玩 →' }).waitFor({ state: 'visible', timeout: 8000 })
})
