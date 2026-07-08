/**
 * Layout regression steps for the 星盘 (dial) module on a phone viewport.
 *
 * Guards the F2 real-device bug: on a 390x844 phone the third (bottom) dial's
 * rotate knobs fell under a bottom-of-screen layer and stopped receiving touch,
 * so a "turn the bottom dial right" instruction was unfollowable without first
 * scrolling. The assertion is a pure viewport hit-test — every dial knob must be
 * its own top hit-test target (nothing overlays it) at the exact failing
 * viewport, with NO scroll first (Playwright's `.click()` auto-scroll is exactly
 * what hid this bug from the play-through scenarios).
 */
import { expect } from '@playwright/test'
import { Then } from './fixtures'

interface KnobHit {
  id: string
  missing?: boolean
  cx: number
  cy: number
  viewportHeight: number
  inViewport: boolean
  owns: boolean
  hit: string
  self: string
}

Then(
  'every 星盘 dial control is its own top hit-test target with nothing overlaying it',
  async ({ page }) => {
    await page.getByTestId('dial-2-right').waitFor({ state: 'visible', timeout: 12_000 })
    // The whole module must fit the phone viewport — no document scroll should be
    // needed to reach the bottom dial or the 确认 button (the F2 symptom was a tall
    // page forcing a scroll, with the bottom row landing under mobile browser
    // chrome). A 1px rounding tolerance only.
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement
      return el ? el.scrollHeight - el.clientHeight : 0
    })
    expect(
      overflow,
      `the 星盘 module overflows the phone viewport by ${overflow}px (needs a scroll)`
    ).toBeLessThanOrEqual(1)
    const ids = [
      'dial-0-left',
      'dial-0-right',
      'dial-1-left',
      'dial-1-right',
      'dial-2-left',
      'dial-2-right',
      'dial-confirm',
    ]
    const report: KnobHit[] = await page.evaluate((knobIds) => {
      const describe = (n: Element | null): string => {
        if (!n) return 'null'
        const cls =
          typeof n.className === 'string' && n.className
            ? `.${n.className.trim().replace(/\s+/g, '.')}`
            : ''
        return `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}${cls}`
      }
      const viewportHeight = window.innerHeight
      return knobIds.map((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`)
        if (!el)
          return {
            id,
            missing: true,
            cx: 0,
            cy: 0,
            viewportHeight,
            inViewport: false,
            owns: false,
            hit: 'null',
            self: 'null',
          }
        const r = el.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const hit = document.elementFromPoint(cx, cy)
        const owns = !!hit && (hit === el || el.contains(hit))
        return {
          id,
          cx: Math.round(cx),
          cy: Math.round(cy),
          viewportHeight,
          inViewport: cy >= 0 && cy <= viewportHeight,
          owns,
          hit: describe(hit),
          self: describe(el),
        }
      })
    }, ids)
    const bad = report.filter((r) => r.missing || !r.owns)
    expect(bad, `dial controls not hit-testable:\n${JSON.stringify(report, null, 2)}`).toHaveLength(
      0
    )
  }
)
