/**
 * balance-store unit tests — the shared last-known-balance singleton behind the
 * TopNav chip. Each case stubs global.fetch (the store reads through
 * `fetchAssets`) and asserts the published snapshot. The store is a module
 * singleton, so `resetBalanceStore` isolates every case.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import type { CompanionAssetsResponse } from '@shared/companion-types'
import {
  getBalanceSnapshot,
  pushBalance,
  reloadBalance,
  resetBalanceStore,
  subscribe,
} from './balance-store'

const ASSETS: CompanionAssetsResponse = {
  asset_type: 'starburst',
  balance: 12,
  entries: [
    { amount: 5, source_product: 'bombsquad', kind: 'win', earned_at: '2026-07-14T00:55:00.000Z' },
  ],
}

function stubAssets(status: number, body?: CompanionAssetsResponse) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(body ? JSON.stringify(body) : null, { status }))
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('balance-store', () => {
  beforeEach(() => {
    resetBalanceStore()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts loading and publishes ready after a successful read', async () => {
    expect(getBalanceSnapshot()).toEqual({ status: 'loading' })

    stubAssets(200, ASSETS)
    await reloadBalance()

    expect(getBalanceSnapshot()).toEqual({
      status: 'ready',
      balance: 12,
      entries: ASSETS.entries,
      welcomeGranted: false,
    })
  })

  it('goes unavailable when the FIRST read fails', async () => {
    stubAssets(500)
    await reloadBalance()

    expect(getBalanceSnapshot()).toEqual({ status: 'unavailable' })
  })

  it('goes unavailable on an anonymous (401) first read', async () => {
    stubAssets(401)
    await reloadBalance()

    expect(getBalanceSnapshot()).toEqual({ status: 'unavailable' })
  })

  it('keeps the last-known value when a TRANSIENT (500) refresh fails', async () => {
    stubAssets(200, ASSETS)
    await reloadBalance()

    // A transient refresh failure (500 / network / malformed → kind 'error')
    // must NOT blank a good balance.
    stubAssets(500)
    await reloadBalance()

    expect(getBalanceSnapshot()).toEqual({
      status: 'ready',
      balance: 12,
      entries: ASSETS.entries,
      welcomeGranted: false,
    })
  })

  it('CLEARS the chip when a refresh returns anon (401) even while ready', async () => {
    stubAssets(200, ASSETS)
    await reloadBalance()
    expect(getBalanceSnapshot()).toMatchObject({ status: 'ready', balance: 12 })

    // A 401 is authoritative (logged out elsewhere / expired cookie). Unlike a
    // transient error, it must clear the private chip, not keep stale account
    // data on screen.
    stubAssets(401)
    await reloadBalance()

    expect(getBalanceSnapshot()).toEqual({ status: 'unavailable' })
  })

  it('force refresh issues a post-return read, not a stale pre-return in-flight one', async () => {
    // Model a return: a pre-departure read is still in flight (deferred, resolves
    // to the OLD balance 12); the return event forces a fresh read that returns
    // the post-return balance 17. The store must land on 17, never 12.
    let resolveFirst!: (res: Response) => void
    const firstRead = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    let call = 0
    const fetchMock = vi.fn(() => {
      call += 1
      return call === 1
        ? firstRead
        : Promise.resolve(new Response(JSON.stringify({ ...ASSETS, balance: 17 }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const initial = reloadBalance() // R1: pre-return, still pending
    const forced = reloadBalance({ force: true }) // return event while R1 in flight

    // R1 finally resolves with the OLD balance — must be superseded, not kept.
    resolveFirst(new Response(JSON.stringify({ ...ASSETS, balance: 12 }), { status: 200 }))
    await Promise.all([initial, forced])

    expect(fetchMock).toHaveBeenCalledTimes(2) // a SECOND read was issued post-return
    expect(getBalanceSnapshot()).toMatchObject({ status: 'ready', balance: 17 })
  })

  it('pushBalance repaints the number and preserves entries + welcome beat', async () => {
    stubAssets(200, { ...ASSETS, balance: 10, welcome_granted: true })
    await reloadBalance()

    pushBalance(15)

    expect(getBalanceSnapshot()).toEqual({
      status: 'ready',
      balance: 15,
      entries: ASSETS.entries,
      welcomeGranted: true,
    })
  })

  it('pushBalance is a no-op before the first successful read', () => {
    pushBalance(99)
    expect(getBalanceSnapshot()).toEqual({ status: 'loading' })
  })

  it('shares one in-flight read across concurrent reloads', async () => {
    const fetchMock = stubAssets(200, ASSETS)
    const first = reloadBalance()
    const second = reloadBalance()

    expect(first).toBe(second)
    await Promise.all([first, second])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('notifies subscribers on change and stops after unsubscribe', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)

    stubAssets(200, ASSETS)
    await reloadBalance()
    expect(listener).toHaveBeenCalled()

    unsubscribe()
    listener.mockClear()
    pushBalance(20)
    expect(listener).not.toHaveBeenCalled()
  })
})
