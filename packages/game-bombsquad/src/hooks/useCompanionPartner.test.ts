/**
 * useCompanionPartner — the connect page's companion co-play gate.
 *
 * Two same-origin reads decide the entry default: GET /api/auth/session
 * (authenticated?) then GET /api/companion (identity or 404). Every failure
 * shape must resolve `unavailable`, keeping the anonymous / companion-less
 * entry flow untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useCompanionPartner } from './useCompanionPartner'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useCompanionPartner', () => {
  it('resolves available with the companion name for a signed-in companion user', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith('/api/auth/session')) {
        return Promise.resolve(
          jsonResponse({ authenticated: true, identity: { user_id: 'u1', email: 'a@b.c' } })
        )
      }
      return Promise.resolve(
        jsonResponse({
          name: '阿澈',
          address_style: '',
          voice_id: 'companion-warm',
          profile_enabled: true,
          voice_posture: 'voice-default',
          created_at: '2026-06-30T00:00:00.000Z',
        })
      )
    })

    const { result } = renderHook(() => useCompanionPartner(true))
    expect(result.current.status).toBe('checking')
    await waitFor(() => {
      expect(result.current).toEqual({ status: 'available', name: '阿澈' })
    })
  })

  it('resolves unavailable for an anonymous visitor without touching /api/companion', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ authenticated: false, identity: null }))

    const { result } = renderHook(() => useCompanionPartner(true))
    await waitFor(() => {
      expect(result.current.status).toBe('unavailable')
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resolves unavailable when the companion read 404s (no companion yet)', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith('/api/auth/session')) {
        return Promise.resolve(jsonResponse({ authenticated: true, identity: {} }))
      }
      return Promise.resolve(jsonResponse({ error: 'no companion set up' }, 404))
    })

    const { result } = renderHook(() => useCompanionPartner(true))
    await waitFor(() => {
      expect(result.current.status).toBe('unavailable')
    })
  })

  it('resolves unavailable on a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useCompanionPartner(true))
    await waitFor(() => {
      expect(result.current.status).toBe('unavailable')
    })
  })

  it('never fetches when disabled (practice entries)', () => {
    const { result } = renderHook(() => useCompanionPartner(false))
    expect(result.current.status).toBe('unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
