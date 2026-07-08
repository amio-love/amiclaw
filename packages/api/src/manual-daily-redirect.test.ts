/**
 * `/manual/daily` literal-route redirect (F11).
 *
 * The dated route handler lives in `functions/manual/[date].ts`. The literal
 * `/manual/daily` (a hand-typed / bookmarked path, not a product link) used to
 * render blank; it now 302-redirects to today's dated manual, preserving the
 * `?format=yaml` query. A genuinely dated path is untouched and still delegates
 * to ASSETS.
 */
import { describe, expect, it, vi } from 'vitest'
import { onRequest } from '../../../functions/manual/[date]'

const today = new Date().toISOString().slice(0, 10)

function context(url: string, date: string, assetsFetch = vi.fn()) {
  return {
    request: new Request(url),
    params: { date },
    env: { ASSETS: { fetch: assetsFetch } },
  }
}

describe('manual /[date] route — /manual/daily redirect', () => {
  it("redirects the literal /manual/daily to today's dated manual", async () => {
    const res = await onRequest(context('https://claw.amio.fans/manual/daily', 'daily'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`https://claw.amio.fans/manual/${today}`)
  })

  it('preserves ?format=yaml on the redirect', async () => {
    const res = await onRequest(context('https://claw.amio.fans/manual/daily?format=yaml', 'daily'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`https://claw.amio.fans/manual/${today}?format=yaml`)
  })

  it('leaves a genuinely dated path to ASSETS (no redirect)', async () => {
    const assetsFetch = vi.fn().mockResolvedValue(new Response('manual body', { status: 200 }))
    const res = await onRequest(
      context('https://claw.amio.fans/manual/2026-07-08', '2026-07-08', assetsFetch)
    )
    expect(res.status).toBe(200)
    expect(assetsFetch).toHaveBeenCalled()
  })
})
