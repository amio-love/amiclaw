import { describe, expect, it, vi } from 'vitest'

import { handoffSettlement } from './settlement-client'

describe('best-effort settlement handoff', () => {
  it('performs one keepalive request with no retry when the request fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    handoffSettlement({
      version: 1,
      runId: '00000000-0000-4000-8000-000000000001',
      attemptId: '11111111-1111-4111-8111-111111111111',
      outcome: 'win',
      durationTicks: 100,
    })
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ keepalive: true, credentials: 'include' })
    vi.unstubAllGlobals()
  })
})
