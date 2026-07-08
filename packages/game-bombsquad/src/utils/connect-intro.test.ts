/**
 * Unit tests for the connect-intro gating utility — the once-per-device flag
 * that controls whether the first-run connect-AI primer renders (F1).
 *
 * Mirrors survey.test.ts: jsdom's localStorage is method-less here, so a small
 * Map-backed fake is installed via vi.stubGlobal so the real util exercises its
 * real branches; a throwing variant covers the storage-failure branches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSeenConnectIntro, markConnectIntroSeen } from './connect-intro'

const KEY = 'bombsquad-connect-intro-seen'

interface FakeLocalStorageOverrides {
  getItem?: (key: string) => string | null
  setItem?: (key: string, value: string) => void
}

function installFakeLocalStorage(overrides: FakeLocalStorageOverrides = {}) {
  const store = new Map<string, string>()
  const fake = {
    getItem:
      overrides.getItem ?? ((key: string) => (store.has(key) ? (store.get(key) as string) : null)),
    setItem:
      overrides.setItem ??
      ((key: string, value: string) => {
        store.set(key, String(value))
      }),
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
  return { store, fake }
}

describe('hasSeenConnectIntro', () => {
  beforeEach(() => {
    installFakeLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns false when no flag is stored (first-run device)', () => {
    expect(hasSeenConnectIntro()).toBe(false)
  })

  it('returns true when the flag is exactly "true"', () => {
    localStorage.setItem(KEY, 'true')
    expect(hasSeenConnectIntro()).toBe(true)
  })

  it('returns false for any stored value other than "true"', () => {
    localStorage.setItem(KEY, 'seen')
    expect(hasSeenConnectIntro()).toBe(false)
  })

  it('returns false when localStorage.getItem throws (errs toward showing once more)', () => {
    installFakeLocalStorage({
      getItem: () => {
        throw new Error('storage disabled')
      },
    })
    expect(hasSeenConnectIntro()).toBe(false)
  })
})

describe('markConnectIntroSeen', () => {
  beforeEach(() => {
    installFakeLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes the flag so hasSeenConnectIntro reads back true', () => {
    expect(hasSeenConnectIntro()).toBe(false)
    markConnectIntroSeen()
    expect(hasSeenConnectIntro()).toBe(true)
    expect(localStorage.getItem(KEY)).toBe('true')
  })

  it('does not throw when localStorage.setItem throws (quota / private mode)', () => {
    installFakeLocalStorage({
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(() => markConnectIntroSeen()).not.toThrow()
  })
})
