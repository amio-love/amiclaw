/**
 * `fetchArcadeProfile` status → result mapping.
 *
 * The anonymous read is a NON-error: the server answers 204 (no session to
 * resolve a profile for) so an anonymous player's settlement makes no red
 * console noise (audit F27). 401 is kept mapped to `anon` for defensiveness.
 * Both must resolve to `{ kind: 'anon' }`, never `error`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchArcadeProfile } from './api-client'

function stubFetch(response: Response | (() => never)): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => (typeof response === 'function' ? response() : Promise.resolve(response)))
  )
}

const OK_BODY = {
  profile: { daily_loop: { streak: { current_days: 3 } } },
  public_profile: { claimed: true, public_label: 'Nova' },
}

describe('fetchArcadeProfile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps an anonymous 204 to anon (no console-noise 401)', async () => {
    stubFetch(new Response(null, { status: 204 }))
    expect(await fetchArcadeProfile()).toEqual({ kind: 'anon' })
  })

  it('still maps a 401 to anon (defensive)', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
    expect(await fetchArcadeProfile()).toEqual({ kind: 'anon' })
  })

  it('maps a 200 body to ok with the profile + public profile', async () => {
    stubFetch(new Response(JSON.stringify(OK_BODY), { status: 200 }))
    expect(await fetchArcadeProfile()).toEqual({
      kind: 'ok',
      profile: OK_BODY.profile,
      publicProfile: OK_BODY.public_profile,
    })
  })

  it('maps a 5xx to error', async () => {
    stubFetch(new Response('boom', { status: 500 }))
    expect(await fetchArcadeProfile()).toEqual({ kind: 'error' })
  })

  it('maps a network throw to error', async () => {
    stubFetch(() => {
      throw new Error('offline')
    })
    expect(await fetchArcadeProfile()).toEqual({ kind: 'error' })
  })
})
