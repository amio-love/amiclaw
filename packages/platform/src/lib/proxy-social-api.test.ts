/**
 * proxy-social-api — the platform client for the two `/ai-intent/*` proxy
 * routes. These pin the discriminated-result mapping that the UI depends on:
 * the V1 background trigger collapses every non-message outcome to `none`, and
 * the V2 reply maps each explicit status (409 reasons / 410 / 429 / 401 / 403 /
 * 404 / 502) to its result kind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendCompanionProxyReply, triggerCompanionProxyMessage } from './proxy-social-api'

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('triggerCompanionProxyMessage (V1)', () => {
  it('maps a messaged response to the target event', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        messaged: true,
        message_id: 'm1',
        target_event: {
          event_id: 'e0123456789abcde',
          template: 'daily_clear',
          target_public_label: '乙',
        },
      })
    )
    const result = await triggerCompanionProxyMessage()
    expect(result).toEqual({
      kind: 'messaged',
      messageId: 'm1',
      targetEvent: {
        event_id: 'e0123456789abcde',
        template: 'daily_clear',
        target_public_label: '乙',
      },
    })
  })

  it('collapses messaged:false to none', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messaged: false }))
    expect(await triggerCompanionProxyMessage()).toEqual({ kind: 'none' })
  })

  it('collapses a refusal status (401 / 429 / 5xx) to none', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: 'rate limit exceeded' }))
    expect(await triggerCompanionProxyMessage()).toEqual({ kind: 'none' })
  })

  it('collapses a network error to none', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(await triggerCompanionProxyMessage()).toEqual({ kind: 'none' })
  })
})

describe('sendCompanionProxyReply (V2)', () => {
  it('maps 200 to ok', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        message_id: 'm1',
        reply_public_label: '乙',
        responder_companion_name: '小满',
      })
    )
    expect(await sendCompanionProxyReply('m1')).toEqual({ kind: 'ok' })
  })

  it.each([
    [409, { reason: 'already-replied' }, 'already-replied'],
    [409, { reason: 'no-companion' }, 'no-companion'],
    [409, { reason: 'no-public-profile' }, 'no-public-profile'],
    [410, {}, 'out-of-window'],
    [429, {}, 'rate-limited'],
    [401, {}, 'anon'],
    [403, {}, 'not-owner'],
    [404, {}, 'not-found'],
    [502, {}, 'error'],
  ])('maps %i → %o', async (status, body, kind) => {
    fetchMock.mockResolvedValue(jsonResponse(status, body))
    expect(await sendCompanionProxyReply('m1')).toEqual({ kind })
  })

  it('maps a network error to error', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(await sendCompanionProxyReply('m1')).toEqual({ kind: 'error' })
  })
})
