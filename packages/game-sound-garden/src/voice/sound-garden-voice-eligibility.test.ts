import { describe, expect, it, vi } from 'vitest'
import { checkSoundGardenVoiceEligibility } from './sound-garden-voice-eligibility'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A fetch double routing `/api/auth/session` + `/api/companion` to fixed responses. */
function fetcher(routes: Record<string, Response>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const key = Object.keys(routes).find((r) => url.includes(r))
    if (!key) throw new Error(`unexpected fetch ${url}`)
    return routes[key]
  }) as unknown as typeof fetch
}

describe('checkSoundGardenVoiceEligibility', () => {
  it('eligible when authenticated with a named companion', async () => {
    const result = await checkSoundGardenVoiceEligibility(
      fetcher({
        '/api/auth/session': jsonResponse({ authenticated: true }),
        '/api/companion': jsonResponse({ name: '小星' }),
      })
    )
    expect(result).toEqual({ status: 'eligible', companionName: '小星' })
  })

  it('anonymous when not authenticated', async () => {
    const result = await checkSoundGardenVoiceEligibility(
      fetcher({ '/api/auth/session': jsonResponse({ authenticated: false }) })
    )
    expect(result).toEqual({ status: 'ineligible', reason: 'anonymous' })
  })

  it('no-companion when the companion is missing (404) or unnamed', async () => {
    expect(
      await checkSoundGardenVoiceEligibility(
        fetcher({
          '/api/auth/session': jsonResponse({ authenticated: true }),
          '/api/companion': new Response(null, { status: 404 }),
        })
      )
    ).toEqual({ status: 'ineligible', reason: 'no-companion' })
    expect(
      await checkSoundGardenVoiceEligibility(
        fetcher({
          '/api/auth/session': jsonResponse({ authenticated: true }),
          '/api/companion': jsonResponse({ name: '   ' }),
        })
      )
    ).toEqual({ status: 'ineligible', reason: 'no-companion' })
  })

  it('unavailable when the session endpoint fails or throws (standalone dev / no Worker)', async () => {
    expect(
      await checkSoundGardenVoiceEligibility(
        fetcher({ '/api/auth/session': new Response(null, { status: 500 }) })
      )
    ).toEqual({ status: 'ineligible', reason: 'unavailable' })
    const throwing = vi.fn(async () => {
      throw new Error('no worker')
    }) as unknown as typeof fetch
    expect(await checkSoundGardenVoiceEligibility(throwing)).toEqual({
      status: 'ineligible',
      reason: 'unavailable',
    })
  })
})
