/**
 * Unit tests for the nickname utility — validation rules plus localStorage
 * read/write semantics. The acceptance criteria from the source task records:
 *   - empty / whitespace-only / >20 chars rejected
 *   - unicode (multi-byte chars like 小明) accepted by character count
 *   - trim before persist
 *   - quota / disabled-storage failures surface as `false` without throwing
 *   - corrupted older values (e.g. 30-char string written before this util
 *     existed) read back as null instead of contaminating submission
 *
 * Note on the localStorage fake: jsdom's `localStorage` in this workspace is
 * stubbed to a method-less object (the test runner emits a
 * `--localstorage-file` warning at boot — see
 * `src/pages/ResultPage.test.tsx` for the precedent). We install a small
 * Map-backed fake via `vi.stubGlobal('localStorage', …)` so the real util can
 * exercise its real branches. For the "storage throws" branches we install a
 * variant whose methods throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NICKNAME_MAX_LENGTH,
  getStoredNickname,
  isValidNickname,
  setStoredNickname,
} from './nickname'

const KEY = 'bombsquad-nickname'

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

describe('isValidNickname', () => {
  it('rejects empty string', () => {
    expect(isValidNickname('')).toBe(false)
  })

  it('rejects whitespace-only input', () => {
    expect(isValidNickname('   ')).toBe(false)
    expect(isValidNickname('\t\n')).toBe(false)
  })

  it('accepts a single-character name', () => {
    expect(isValidNickname('A')).toBe(true)
  })

  it('accepts the boundary length of 20 chars', () => {
    expect(isValidNickname('a'.repeat(NICKNAME_MAX_LENGTH))).toBe(true)
  })

  it('rejects 21 chars (over cap)', () => {
    expect(isValidNickname('a'.repeat(NICKNAME_MAX_LENGTH + 1))).toBe(false)
  })

  it('accepts CJK chars by character count', () => {
    // 小明 — 2 characters, well under the 20-char cap.
    expect(isValidNickname('小明')).toBe(true)
  })

  it('accepts values whose visible portion is within the cap after trim', () => {
    // 18 visible chars + 2 leading + 2 trailing spaces → trimmed length 18.
    expect(isValidNickname(`  ${'a'.repeat(18)}  `)).toBe(true)
  })

  it('rejects values whose trimmed length still exceeds the cap', () => {
    // 21 visible chars with trailing space — trim drops the space but length stays 21.
    expect(isValidNickname(`${'a'.repeat(21)} `)).toBe(false)
  })

  it('rejects non-string inputs defensively', () => {
    expect(isValidNickname(null)).toBe(false)
    expect(isValidNickname(undefined)).toBe(false)
    expect(isValidNickname(123)).toBe(false)
  })
})

describe('getStoredNickname', () => {
  beforeEach(() => {
    installFakeLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when localStorage has no entry', () => {
    expect(getStoredNickname()).toBeNull()
  })

  it('returns the trimmed stored value when valid', () => {
    localStorage.setItem(KEY, '  小明  ')
    expect(getStoredNickname()).toBe('小明')
  })

  it('returns null when the stored value is whitespace-only', () => {
    localStorage.setItem(KEY, '   ')
    expect(getStoredNickname()).toBeNull()
  })

  it('returns null when the stored value exceeds the cap (corrupted data)', () => {
    localStorage.setItem(KEY, 'a'.repeat(30))
    expect(getStoredNickname()).toBeNull()
  })

  it('returns null when localStorage.getItem throws', () => {
    installFakeLocalStorage({
      getItem: () => {
        throw new Error('storage disabled')
      },
    })
    expect(getStoredNickname()).toBeNull()
  })
})

describe('setStoredNickname', () => {
  beforeEach(() => {
    installFakeLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes the trimmed value and returns true on success', () => {
    expect(setStoredNickname('  小明  ')).toBe(true)
    expect(localStorage.getItem(KEY)).toBe('小明')
  })

  it('returns false and does not write when the value is empty', () => {
    expect(setStoredNickname('')).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('returns false and does not write when the value is whitespace-only', () => {
    expect(setStoredNickname('   ')).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('returns false and does not write when the value exceeds the cap', () => {
    expect(setStoredNickname('a'.repeat(NICKNAME_MAX_LENGTH + 1))).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('returns false when localStorage.setItem throws (quota exceeded)', () => {
    installFakeLocalStorage({
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(setStoredNickname('小明')).toBe(false)
  })

  it('round-trips through getStoredNickname', () => {
    setStoredNickname('小红')
    expect(getStoredNickname()).toBe('小红')
  })
})
