/**
 * Unit tests for the survey gating utility — the once-per-device flag that
 * controls whether the post-game survey section renders.
 *
 * Note on the localStorage fake: jsdom's `localStorage` in this workspace is
 * stubbed to a method-less object (the test runner emits a
 * `--localstorage-file` warning at boot — see `nickname.test.ts` for the
 * precedent). We install a small Map-backed fake via
 * `vi.stubGlobal('localStorage', …)` so the real util exercises its real
 * branches. For the "storage throws" branches we install a throwing variant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasAnsweredSurvey, markSurveyAnswered } from './survey'

const KEY = 'bombsquad-survey-answered'

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

describe('hasAnsweredSurvey', () => {
  beforeEach(() => {
    installFakeLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns false when no flag is stored', () => {
    expect(hasAnsweredSurvey()).toBe(false)
  })

  it('returns true when the flag is exactly "true"', () => {
    localStorage.setItem(KEY, 'true')
    expect(hasAnsweredSurvey()).toBe(true)
  })

  it('returns false for any stored value other than "true"', () => {
    localStorage.setItem(KEY, 'false')
    expect(hasAnsweredSurvey()).toBe(false)
    localStorage.setItem(KEY, '1')
    expect(hasAnsweredSurvey()).toBe(false)
    localStorage.setItem(KEY, 'yes')
    expect(hasAnsweredSurvey()).toBe(false)
  })

  it('returns false when localStorage.getItem throws', () => {
    installFakeLocalStorage({
      getItem: () => {
        throw new Error('storage disabled')
      },
    })
    expect(hasAnsweredSurvey()).toBe(false)
  })
})

describe('markSurveyAnswered', () => {
  beforeEach(() => {
    installFakeLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes the flag so hasAnsweredSurvey reads back true', () => {
    expect(hasAnsweredSurvey()).toBe(false)
    markSurveyAnswered()
    expect(hasAnsweredSurvey()).toBe(true)
    expect(localStorage.getItem(KEY)).toBe('true')
  })

  it('is idempotent — a second call leaves the flag set', () => {
    markSurveyAnswered()
    markSurveyAnswered()
    expect(hasAnsweredSurvey()).toBe(true)
  })

  it('does not throw when localStorage.setItem throws (quota / private mode)', () => {
    installFakeLocalStorage({
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(() => markSurveyAnswered()).not.toThrow()
  })
})
