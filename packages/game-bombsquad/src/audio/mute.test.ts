/**
 * Unit tests for the audio mute store.
 *
 * Note on the localStorage fake: jsdom's `localStorage` in this workspace is
 * stubbed to a method-less object (see `src/utils/nickname.test.ts` for the
 * precedent). We install a small Map-backed fake via `vi.stubGlobal` so the
 * real store can exercise its real read/persist branches. The store reads
 * localStorage once at import time, so each test resets the module registry
 * and re-imports against a freshly-installed fake.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const STORAGE_KEY = 'bombsquad:audio-muted'

function installFakeLocalStorage() {
  const store = new Map<string, string>()
  const fake = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  }
  vi.stubGlobal('localStorage', fake)
  return store
}

describe('audio mute store', () => {
  let store: Map<string, string>

  beforeEach(() => {
    vi.resetModules()
    store = installFakeLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to unmuted when nothing is persisted', async () => {
    const { isMuted } = await import('./mute')
    expect(isMuted()).toBe(false)
  })

  it('initializes from a persisted muted=true preference', async () => {
    store.set(STORAGE_KEY, 'true')
    const { isMuted } = await import('./mute')
    expect(isMuted()).toBe(true)
  })

  it('setMuted flips state and persists to localStorage', async () => {
    const { setMuted, isMuted } = await import('./mute')
    setMuted(true)
    expect(isMuted()).toBe(true)
    expect(store.get(STORAGE_KEY)).toBe('true')
    setMuted(false)
    expect(isMuted()).toBe(false)
    expect(store.get(STORAGE_KEY)).toBe('false')
  })

  it('toggleMuted alternates the state', async () => {
    const { toggleMuted, isMuted } = await import('./mute')
    expect(isMuted()).toBe(false)
    toggleMuted()
    expect(isMuted()).toBe(true)
    toggleMuted()
    expect(isMuted()).toBe(false)
  })

  it('setMuted is a no-op when the value is unchanged', async () => {
    const { setMuted } = await import('./mute')
    setMuted(false)
    expect(store.has(STORAGE_KEY)).toBe(false)
  })

  it('persisted preference survives a simulated refresh (re-import)', async () => {
    const first = await import('./mute')
    first.setMuted(true)
    expect(store.get(STORAGE_KEY)).toBe('true')
    vi.resetModules()
    const second = await import('./mute')
    expect(second.isMuted()).toBe(true)
  })
})
