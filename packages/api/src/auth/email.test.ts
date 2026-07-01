import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResendSender } from './email'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createResendSender', () => {
  it('falls back to a no-send dev sender when RESEND_API_KEY is unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sender = createResendSender({ AUTH: {} as unknown as KVNamespace })

    const result = await sender({ to: 'a@example.com', verifyUrl: 'https://x/verify?token=t' })

    expect(result.sent).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled() // never hits the network in dev
    expect(warnSpy).toHaveBeenCalled()
  })

  it('POSTs to the Resend endpoint with bearer auth when a key is set', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'e1' }), { status: 200 }))
    const sender = createResendSender({
      AUTH: {} as unknown as KVNamespace,
      RESEND_API_KEY: 'test_key',
      AUTH_EMAIL_FROM: 'AMIO Arcade <login@claw.amio.fans>',
    })

    const result = await sender({ to: 'a@example.com', verifyUrl: 'https://x/verify?token=t' })

    expect(result.sent).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test_key')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.to).toBe('a@example.com')
    expect(body.from).toBe('AMIO Arcade <login@claw.amio.fans>')
    expect(body.html).toContain('https://x/verify?token=t')
  })

  it('reports a failure (not a throw) on a non-OK Resend response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }))
    const sender = createResendSender({
      AUTH: {} as unknown as KVNamespace,
      RESEND_API_KEY: 'test_key',
    })
    const result = await sender({ to: 'a@example.com', verifyUrl: 'https://x/verify?token=t' })
    expect(result.sent).toBe(false)
    expect(result.error).toContain('429')
  })
})
