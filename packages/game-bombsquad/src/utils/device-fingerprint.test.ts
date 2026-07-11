/**
 * getDeviceId storage-degradation tests (gate F2).
 *
 * On a storage-restricted context (site storage blocked, strict tracking
 * prevention, some in-app webviews) `localStorage` access throws a
 * SecurityError. getDeviceId must NOT propagate that throw — an uncaught
 * exception here froze the settlement on「正在把成绩送上榜…」forever, since it
 * runs synchronously inside the submission build after the spinner is shown.
 * It degrades to a stable per-session in-memory id instead so the run still
 * submits.
 *
 * Each test re-imports the module so the module-level in-memory id starts
 * fresh and cannot leak across cases.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const DEVICE_ID_KEY = 'bombsquad-device-id'

async function freshGetDeviceId() {
  vi.resetModules()
  const mod = await import('./device-fingerprint')
  return mod.getDeviceId
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getDeviceId', () => {
  it('returns the stored id when localStorage is available', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === DEVICE_ID_KEY ? 'stored-device-id' : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
    const getDeviceId = await freshGetDeviceId()
    expect(getDeviceId()).toBe('stored-device-id')
  })

  it('generates and persists a new id when none is stored', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    })
    const getDeviceId = await freshGetDeviceId()
    const id = getDeviceId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    // Written through and stable on the next read.
    expect(store.get(DEVICE_ID_KEY)).toBe(id)
    expect(getDeviceId()).toBe(id)
  })

  it('does not throw and returns a stable id when localStorage access throws', async () => {
    vi.stubGlobal('localStorage', {
      get getItem() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
      setItem() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    const getDeviceId = await freshGetDeviceId()

    let first: string | undefined
    expect(() => {
      first = getDeviceId()
    }).not.toThrow()
    expect(typeof first).toBe('string')
    expect((first as string).length).toBeGreaterThan(0)
    // Stable across calls within the session despite storage being unavailable.
    expect(getDeviceId()).toBe(first)
  })

  it('degrades to an in-memory id when setItem throws at quota on a fresh device', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null, // fresh device — nothing stored yet
      setItem() {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      },
      removeItem: vi.fn(),
    })
    const getDeviceId = await freshGetDeviceId()
    let id: string | undefined
    expect(() => {
      id = getDeviceId()
    }).not.toThrow()
    expect(id).toBeTruthy()
    expect(getDeviceId()).toBe(id)
  })
})
