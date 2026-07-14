/**
 * balance-store unit tests — the shared last-known-balance singleton behind the
 * TopNav chip. Each case stubs global.fetch (the store reads through
 * `fetchAssets`) and asserts the published snapshot. The store is a module
 * singleton, so `resetBalanceStore` isolates every case.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import type { CompanionAssetsResponse } from '@shared/companion-types'
import { getBalanceSnapshot, reloadBalance, resetBalanceStore, subscribe } from './balance-store'

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

  it('force refresh reads immediately; a late pre-return read cannot clobber it', async () => {
    // Model a return while an earlier read HANGS: R1 (pre-departure) never
    // resolves until we say so; the forced return read R2 returns the fresh
    // balance 17. The forced read must fire immediately (not wait for R1) and
    // win, and R1's late OLD-balance (12) result must be discarded, not applied.
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

    const initial = reloadBalance() // R1: pre-return, hangs
    const forced = reloadBalance({ force: true }) // return event: must issue NOW

    // Immediacy: the forced read already fired a second fetch without waiting for
    // the hung R1 to settle.
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await forced
    expect(getBalanceSnapshot()).toMatchObject({ status: 'ready', balance: 17 })

    // Last-issued-wins: R1 finally resolves with the stale 12 — the generation
    // guard discards it, so the forced read's 17 stands.
    resolveFirst(new Response(JSON.stringify({ ...ASSETS, balance: 12 }), { status: 200 }))
    await initial
    expect(getBalanceSnapshot()).toMatchObject({ status: 'ready', balance: 17 })
  })

  it('a STALE anon (401) read still clears the chip, outranking last-issued-wins', async () => {
    // Two reads race: R1 (older gen) hangs, then resolves 401; R2 (newer, the
    // latest gen) resolves ok. A 401 is authoritative — the session is gone — so
    // even the stale R1 must clear the chip, overriding the newer R2's balance.
    let resolveFirst!: (res: Response) => void
    const firstRead = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    let call = 0
    const fetchMock = vi.fn(() => {
      call += 1
      return call === 1
        ? firstRead
        : Promise.resolve(new Response(JSON.stringify(ASSETS), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const older = reloadBalance() // R1: older gen, hangs
    const newer = reloadBalance({ force: true }) // R2: latest gen, resolves ok
    await newer
    expect(getBalanceSnapshot()).toMatchObject({ status: 'ready', balance: 12 })

    // R1 finally resolves as a 401 — despite being the stale/older read, it must
    // clear the private chip rather than be discarded by the generation guard.
    resolveFirst(new Response(null, { status: 401 }))
    await older
    expect(getBalanceSnapshot()).toEqual({ status: 'unavailable' })
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
    // A further state change (a fresh read to a new balance) must not reach the
    // unsubscribed listener.
    stubAssets(200, { ...ASSETS, balance: 99 })
    await reloadBalance()
    expect(listener).not.toHaveBeenCalled()
  })
})
