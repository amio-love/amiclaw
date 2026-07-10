import { describe, expect, it, vi } from 'vitest'

import { checkShadowVoiceEligibility } from './voice-eligibility'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Shadow voice eligibility preflight', () => {
  it('checks same-origin auth before the existing companion identity', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ authenticated: true }))
      .mockResolvedValueOnce(json({ name: '小影' }))

    await expect(checkShadowVoiceEligibility(fetcher)).resolves.toEqual({
      status: 'eligible',
      companionName: '小影',
    })
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/api/auth/session',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/companion',
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('stops before companion lookup for an anonymous player', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ authenticated: false }))

    await expect(checkShadowVoiceEligibility(fetcher)).resolves.toEqual({
      status: 'ineligible',
      reason: 'anonymous',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    [json({ error: 'none' }, 404), 'no-companion'],
    [json({ name: '' }), 'no-companion'],
    [json({ error: 'unavailable' }, 503), 'unavailable'],
  ] as const)('keeps voice unavailable for companion response %#', async (response, reason) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ authenticated: true }))
      .mockResolvedValueOnce(response)

    await expect(checkShadowVoiceEligibility(fetcher)).resolves.toEqual({
      status: 'ineligible',
      reason,
    })
  })

  it('fails closed when the preflight cannot reach the API', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))

    await expect(checkShadowVoiceEligibility(fetcher)).resolves.toEqual({
      status: 'ineligible',
      reason: 'unavailable',
    })
  })
})
